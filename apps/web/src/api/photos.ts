import {
  CheckPhotosRequestSchema,
  CreatePhotoPostRequestSchema,
  detectImageFormat,
  ListPhotosQuerySchema,
  UpdateDevelopmentRequestSchema,
  UpdatePhotoRequestSchema,
  UploadDevelopmentMetadataSchema,
  UploadPhotoMetadataSchema,
  UploadRawMetadataSchema,
} from "@omoide/core";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { photoDevelopments, photos } from "~/db/schema";
import {
  addDevelopmentToPhotoRecord,
  addPostToPhotoRecord,
  attachRawToPhotoRecord,
  checkExistingPhotos,
  deleteDevelopmentRecord,
  deletePhotoPostRecord,
  getPhotoDetailById,
  listPhotosForUser,
  sha256Hex,
  updateDevelopmentRecord,
  updatePhotoRecord,
  upsertPhotoRecord,
} from "~/server/photos";
import {
  createR2PresignedUrl,
  deleteR2Object,
  getR2ObjectResponse,
  putR2Object,
} from "~/server/r2";
import type { ApiEnv } from "./middleware";

export const photosRouter = new Hono<ApiEnv>();

/**
 * POST /api/v1/photos/check
 * Batch check which SHA-256 JPEG hashes already exist in D1 for the user.
 */
photosRouter.post(
  "/check",
  describeRoute({
    tags: ["Photos"],
    summary: "Batch check existing photo SHA-256 hashes",
    description:
      "Used by @omoide/cli before uploading to skip already-uploaded JPEGs, RAWs, and developed variants.",
  }),
  async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = CheckPhotosRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid request body", details: parsed.error.flatten() }, 400);
    }

    const db = c.get("db");
    const actor = c.get("actor");
    const items = await checkExistingPhotos(db, actor.userId, parsed.data.hashes);

    return c.json({ items });
  },
);

/**
 * GET /api/v1/photos
 * List photos with Sony a7C EXIF filters, favorite/RAW/developed filters, and facets.
 */
photosRouter.get(
  "/",
  describeRoute({
    tags: ["Photos"],
    summary: "List photos with filters and facets",
  }),
  async (c) => {
    const rawQuery = c.req.query();
    const parsed = ListPhotosQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      return c.json({ error: "Invalid query parameters", details: parsed.error.flatten() }, 400);
    }

    const db = c.get("db");
    const actor = c.get("actor");
    const response = await listPhotosForUser(db, actor.userId, parsed.data);
    return c.json(response);
  },
);

/**
 * POST /api/v1/photos
 * Upload a base JPEG photo + EXIF metadata + BlurHash.
 * Accepts either multipart/form-data (`metadata` JSON + `jpeg` File + optional `thumb` File)
 * or application/json (`metadata` object + optional base64 `jpegBase64`).
 */
photosRouter.post(
  "/",
  describeRoute({
    tags: ["Photos"],
    summary: "Upload a base JPEG photo and EXIF metadata",
  }),
  async (c) => {
    const contentType = c.req.header("content-type") ?? "";
    const db = c.get("db");
    const actor = c.get("actor");

    let metadataRaw: unknown;
    let jpegBytes: ArrayBuffer | null = null;
    let thumbBytes: ArrayBuffer | null = null;
    let thumbMime = "image/avif";

    if (contentType.includes("multipart/form-data")) {
      const formData = await c.req.formData();
      const metaField = formData.get("metadata");
      if (typeof metaField !== "string") {
        return c.json({ error: "Missing metadata JSON field in formData" }, 400);
      }
      try {
        metadataRaw = JSON.parse(metaField);
      } catch {
        return c.json({ error: "Invalid JSON in metadata field" }, 400);
      }

      const jpegFile = formData.get("jpeg");
      if (jpegFile instanceof File) {
        jpegBytes = await jpegFile.arrayBuffer();
      }
      const thumbFile = formData.get("thumb");
      if (thumbFile instanceof File) {
        thumbBytes = await thumbFile.arrayBuffer();
        if (thumbFile.type) thumbMime = thumbFile.type;
      }
    } else {
      const body = await c.req.json().catch(() => null);
      metadataRaw = body?.metadata ?? body;
      if (typeof body?.jpegBase64 === "string") {
        const binary = Uint8Array.from(atob(body.jpegBase64), (ch) => ch.charCodeAt(0));
        jpegBytes = binary.buffer;
      }
    }

    const parsed = UploadPhotoMetadataSchema.safeParse(metadataRaw);
    if (!parsed.success) {
      return c.json({ error: "Invalid photo metadata", details: parsed.error.flatten() }, 400);
    }

    const { photoId, jpegKey, thumbKey, detail } = await upsertPhotoRecord(
      db,
      actor.userId,
      parsed.data,
      Boolean(thumbBytes),
    );

    if (jpegBytes && c.env.PHOTOS_BUCKET) {
      await putR2Object(c.env.PHOTOS_BUCKET, jpegKey, jpegBytes, "image/jpeg");
    }
    if (thumbBytes && thumbKey && c.env.PHOTOS_BUCKET) {
      await putR2Object(c.env.PHOTOS_BUCKET, thumbKey, thumbBytes, thumbMime);
    }

    return c.json({ photoId, photo: detail }, 201);
  },
);

/**
 * GET /api/v1/photos/:id
 * Get full photo detail including 1:N developed variants and 1:N social posts.
 */
photosRouter.get(
  "/:id",
  describeRoute({
    tags: ["Photos"],
    summary: "Get photo detail by UUIDv7",
  }),
  async (c) => {
    const photoId = c.req.param("id");
    const db = c.get("db");
    const actor = c.get("actor");

    const detail = await getPhotoDetailById(db, actor.userId, photoId);
    if (!detail) {
      return c.json({ error: "Photo not found" }, 404);
    }

    return c.json(detail);
  },
);

/**
 * PATCH /api/v1/photos/:id
 * Toggle favorite status or update description.
 */
photosRouter.patch(
  "/:id",
  describeRoute({
    tags: ["Photos"],
    summary: "Update photo favorite status or description",
  }),
  async (c) => {
    const photoId = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = UpdatePhotoRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid update payload", details: parsed.error.flatten() }, 400);
    }

    const db = c.get("db");
    const actor = c.get("actor");
    const updated = await updatePhotoRecord(db, actor.userId, photoId, parsed.data);
    if (!updated) {
      return c.json({ error: "Photo not found" }, 404);
    }

    return c.json(updated);
  },
);

/**
 * POST /api/v1/photos/:id/raw
 * Attach 1:1 Sony .ARW RAW file to a photo.
 * Supports either multipart/form-data (`metadata` + `raw` binary) OR
 * application/json (`metadata` + optional `requestPresignedPut: true`).
 */
photosRouter.post(
  "/:id/raw",
  describeRoute({
    tags: ["Photos"],
    summary: "Attach 1:1 Sony .ARW RAW file to a photo",
  }),
  async (c) => {
    const photoId = c.req.param("id");
    const contentType = c.req.header("content-type") ?? "";
    const db = c.get("db");
    const actor = c.get("actor");

    let metadataRaw: unknown;
    let rawBytes: ArrayBuffer | null = null;
    let requestPresignedPut = false;

    if (contentType.includes("multipart/form-data")) {
      const formData = await c.req.formData();
      const metaField = formData.get("metadata");
      if (typeof metaField !== "string") {
        return c.json({ error: "Missing metadata JSON field" }, 400);
      }
      try {
        metadataRaw = JSON.parse(metaField);
      } catch {
        return c.json({ error: "Invalid JSON in metadata field" }, 400);
      }
      const rawFile = formData.get("raw");
      if (rawFile instanceof File) {
        rawBytes = await rawFile.arrayBuffer();
      }
    } else {
      const body = await c.req.json().catch(() => null);
      metadataRaw = body?.metadata ?? body;
      requestPresignedPut = Boolean(body?.requestPresignedPut);
    }

    const parsed = UploadRawMetadataSchema.safeParse(metadataRaw);
    if (!parsed.success) {
      return c.json({ error: "Invalid RAW metadata", details: parsed.error.flatten() }, 400);
    }

    const result = await attachRawToPhotoRecord(db, actor.userId, photoId, parsed.data);
    if (!result) {
      return c.json({ error: "Photo not found" }, 404);
    }

    if (rawBytes && c.env.PHOTOS_BUCKET) {
      await putR2Object(c.env.PHOTOS_BUCKET, result.rawKey, rawBytes, "image/x-sony-arw");
    }

    const presignedPut = requestPresignedPut
      ? await createR2PresignedUrl(c.env, {
          key: result.rawKey,
          method: "PUT",
          contentType: "image/x-sony-arw",
        })
      : null;

    return c.json({
      photo: result.detail,
      rawKey: result.rawKey,
      presignedPutUrl: presignedPut?.url ?? null,
    });
  },
);

/**
 * PUT /api/v1/photos/:id/asset/raw
 * Direct binary stream upload for .ARW RAW file when presigned URLs are not used.
 */
photosRouter.put("/:id/asset/raw", async (c) => {
  const photoId = c.req.param("id");
  const db = c.get("db");
  const actor = c.get("actor");

  const rows = await db
    .select()
    .from(photos)
    .where(and(eq(photos.id, photoId), eq(photos.userId, actor.userId)))
    .limit(1);

  const row = rows[0];
  if (!row?.rawKey) {
    return c.json({ error: "Photo or RAW metadata not found" }, 404);
  }

  const body = await c.req.arrayBuffer();
  if (c.env.PHOTOS_BUCKET) {
    await putR2Object(c.env.PHOTOS_BUCKET, row.rawKey, body, "image/x-sony-arw");
  }

  return c.json({ ok: true, rawKey: row.rawKey });
});

/**
 * POST /api/v1/photos/:id/developments
 * Upload a 1:N developed variant (webp, png, jpeg, avif) for a photo.
 * multipart/form-data (`metadata` JSON + `file` binary) stores the verified file, then the row.
 * application/json registers metadata alone, with no file.
 */
photosRouter.post(
  "/:id/developments",
  describeRoute({
    tags: ["Photos"],
    summary: "Upload a 1:N developed image variant (webp, png, jpeg, avif)",
    description:
      "Send multipart/form-data with a `metadata` JSON field and a `file` to store the file, then its row. Send application/json with the metadata alone to register a row with no file; that leaves an existing row with the same sha256 unchanged. Re-uploading an existing sha256 keeps its ID, favorite and posts.",
    requestBody: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            required: ["metadata", "file"],
            properties: {
              metadata: { type: "string", description: "UploadDevelopmentMetadata as JSON" },
              file: { type: "string", format: "binary" },
            },
          },
        },
        "application/json": {
          schema: { type: "object", description: "UploadDevelopmentMetadata" },
        },
      },
    },
    responses: {
      201: { description: "The stored version, as `{ development }`" },
      400: {
        description:
          "Invalid metadata, a missing file, a file that doesn't match its metadata, or a format that differs from the stored one",
      },
      404: { description: "Photo not found" },
    },
  }),
  async (c) => {
    const photoId = c.req.param("id");
    const contentType = c.req.header("content-type") ?? "";
    const db = c.get("db");
    const actor = c.get("actor");

    let metadataRaw: unknown;
    let fileBytes: ArrayBuffer | null = null;

    if (contentType.includes("multipart/form-data")) {
      const formData = await c.req.formData();
      const metaField = formData.get("metadata");
      if (typeof metaField !== "string") {
        return c.json({ error: "Missing metadata JSON field" }, 400);
      }
      try {
        metadataRaw = JSON.parse(metaField);
      } catch {
        return c.json({ error: "Invalid JSON in metadata field" }, 400);
      }
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return c.json({ error: "Missing file field" }, 400);
      }
      fileBytes = await file.arrayBuffer();
    } else {
      const body = await c.req.json().catch(() => null);
      metadataRaw = body?.metadata ?? body;
    }

    const parsed = UploadDevelopmentMetadataSchema.safeParse(metadataRaw);
    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid development metadata",
          details: parsed.error.flatten(),
        },
        400,
      );
    }

    if (fileBytes) {
      if (fileBytes.byteLength !== parsed.data.byteSize) {
        return c.json({ error: "File size does not match what was sent" }, 400);
      }
      if ((await sha256Hex(fileBytes)) !== parsed.data.sha256) {
        return c.json({ error: "File contents do not match what was sent" }, 400);
      }
      if (detectImageFormat(new Uint8Array(fileBytes)) !== parsed.data.format) {
        return c.json(
          { error: `This file is not a ${parsed.data.format.toUpperCase()} image` },
          400,
        );
      }
    }

    const mimeMap: Record<string, string> = {
      webp: "image/webp",
      png: "image/png",
      jpeg: "image/jpeg",
      avif: "image/avif",
    };
    const verifiedBytes = fileBytes;
    const storeFile = verifiedBytes
      ? (r2Key: string) =>
          putR2Object(
            c.env.PHOTOS_BUCKET,
            r2Key,
            verifiedBytes,
            mimeMap[parsed.data.format] ?? "application/octet-stream",
          )
      : undefined;

    const result = await addDevelopmentToPhotoRecord(
      db,
      actor.userId,
      photoId,
      parsed.data,
      storeFile,
    );
    if (result.status === "photo_not_found") {
      return c.json({ error: "Photo not found" }, 404);
    }
    if (result.status === "format_mismatch") {
      return c.json(
        { error: `This file is already stored as ${result.format.toUpperCase()}` },
        400,
      );
    }

    return c.json({ development: result.item }, 201);
  },
);

/**
 * PATCH /api/v1/photos/:id/developments/:devId
 * Toggle a developed variant's favorite status, independently of the photo's.
 */
photosRouter.patch(
  "/:id/developments/:devId",
  describeRoute({
    tags: ["Photos"],
    summary: "Update a developed variant's favorite status",
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            additionalProperties: false,
            properties: { isFavorite: { type: "boolean" } },
          },
        },
      },
    },
    responses: {
      200: { description: "The updated version, as `{ development }`" },
      400: { description: "Invalid update payload" },
      404: { description: "Developed variant not found for this photo and user" },
    },
  }),
  async (c) => {
    const photoId = c.req.param("id");
    const devId = c.req.param("devId");
    const body = await c.req.json().catch(() => null);
    const parsed = UpdateDevelopmentRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid update payload", details: parsed.error.flatten() }, 400);
    }

    const db = c.get("db");
    const actor = c.get("actor");
    const development = await updateDevelopmentRecord(
      db,
      actor.userId,
      photoId,
      devId,
      parsed.data,
    );
    if (!development) {
      return c.json({ error: "Developed variant not found" }, 404);
    }

    return c.json({ development });
  },
);

/**
 * DELETE /api/v1/photos/:id/developments/:devId
 * Delete a developed variant and its file. Posts of it stay, marked as posts of a deleted version.
 */
photosRouter.delete(
  "/:id/developments/:devId",
  describeRoute({
    tags: ["Photos"],
    summary: "Delete a developed variant and its file",
    responses: {
      200: { description: "`{ ok, deletedVersionLabel, updatedAt }`" },
      404: { description: "Developed variant not found for this photo and user" },
    },
  }),
  async (c) => {
    const db = c.get("db");
    const actor = c.get("actor");
    const deleted = await deleteDevelopmentRecord(
      db,
      actor.userId,
      c.req.param("id"),
      c.req.param("devId"),
      (r2Key) => deleteR2Object(c.env.PHOTOS_BUCKET, r2Key),
    );
    if (!deleted) {
      return c.json({ error: "Developed variant not found" }, 404);
    }

    return c.json({ ok: true, ...deleted });
  },
);

/**
 * POST /api/v1/photos/:id/posts
 * Add a 1:N social post record (Instagram, Twitter/X, Blog, Portfolio).
 */
photosRouter.post(
  "/:id/posts",
  describeRoute({
    tags: ["Photos"],
    summary: "Register a social media post URL for a photo",
  }),
  async (c) => {
    const photoId = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = CreatePhotoPostRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid post payload", details: parsed.error.flatten() }, 400);
    }

    const db = c.get("db");
    const actor = c.get("actor");
    const result = await addPostToPhotoRecord(db, actor.userId, photoId, parsed.data);
    if (result.status === "photo_not_found") {
      return c.json({ error: "Photo not found" }, 404);
    }
    if (result.status === "development_not_found") {
      return c.json({ error: "This version does not belong to this photo" }, 400);
    }

    return c.json({ post: result.post }, 201);
  },
);

/**
 * DELETE /api/v1/photos/:id/posts/:postId
 * Remove a social post link from a photo.
 */
photosRouter.delete(
  "/:id/posts/:postId",
  describeRoute({
    tags: ["Photos"],
    summary: "Delete a social media post record",
  }),
  async (c) => {
    const photoId = c.req.param("id");
    const postId = c.req.param("postId");
    const db = c.get("db");
    const actor = c.get("actor");

    const deleted = await deletePhotoPostRecord(db, actor.userId, photoId, postId);
    if (!deleted) {
      return c.json({ error: "Post not found" }, 404);
    }

    return c.json({ ok: true });
  },
);

/**
 * Asset streaming endpoints from R2
 */
photosRouter.get("/:id/asset/jpeg", async (c) => {
  const photoId = c.req.param("id");
  const db = c.get("db");
  const actor = c.get("actor");

  const rows = await db
    .select()
    .from(photos)
    .where(and(eq(photos.id, photoId), eq(photos.userId, actor.userId)))
    .limit(1);

  const row = rows[0];
  if (!row) return c.json({ error: "Photo not found" }, 404);

  return getR2ObjectResponse(c.env.PHOTOS_BUCKET, row.jpegKey, "image/jpeg");
});

photosRouter.get("/:id/asset/thumb", async (c) => {
  const photoId = c.req.param("id");
  const db = c.get("db");
  const actor = c.get("actor");

  const rows = await db
    .select()
    .from(photos)
    .where(and(eq(photos.id, photoId), eq(photos.userId, actor.userId)))
    .limit(1);

  const row = rows[0];
  if (!row) return c.json({ error: "Photo not found" }, 404);

  const key = row.thumbKey ?? row.jpegKey;
  return getR2ObjectResponse(c.env.PHOTOS_BUCKET, key, "image/avif");
});

photosRouter.get("/:id/asset/raw", async (c) => {
  const photoId = c.req.param("id");
  const db = c.get("db");
  const actor = c.get("actor");

  const rows = await db
    .select()
    .from(photos)
    .where(and(eq(photos.id, photoId), eq(photos.userId, actor.userId)))
    .limit(1);

  const row = rows[0];
  if (!row?.hasRaw || !row.rawKey) {
    return c.json({ error: "RAW file not found" }, 404);
  }

  const arwFilename = `${row.originalFilename.replace(/\.[^.]+$/, "")}.ARW`;
  return getR2ObjectResponse(c.env.PHOTOS_BUCKET, row.rawKey, "image/x-sony-arw", arwFilename);
});

photosRouter.get("/:id/developments/:devId/asset", async (c) => {
  const photoId = c.req.param("id");
  const devId = c.req.param("devId");
  const db = c.get("db");
  const actor = c.get("actor");

  const rows = await db
    .select()
    .from(photoDevelopments)
    .where(
      and(
        eq(photoDevelopments.id, devId),
        eq(photoDevelopments.photoId, photoId),
        eq(photoDevelopments.userId, actor.userId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return c.json({ error: "Developed variant not found" }, 404);

  const mimeMap: Record<string, string> = {
    webp: "image/webp",
    png: "image/png",
    jpeg: "image/jpeg",
    avif: "image/avif",
  };

  return getR2ObjectResponse(
    c.env.PHOTOS_BUCKET,
    row.r2Key,
    mimeMap[row.format] ?? "application/octet-stream",
  );
});
