import {
  type ApiPhotoDetail,
  type ApiPhotoSummary,
  type CheckedPhotoStatus,
  type CreatePhotoPostRequest,
  type DevelopedFormat,
  type ListPhotosQuery,
  type ListPhotosResponse,
  type PhotoDevelopmentItem,
  type PhotoPostItem,
  r2Keys,
  type SocialPlatform,
  type UpdateDevelopmentRequest,
  type UpdatePhotoRequest,
  type UploadDevelopmentMetadata,
  type UploadPhotoMetadata,
  type UploadRawMetadata,
  uuidv7,
  uuidv7FromExifTimestamp,
} from "@omoide/core";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "~/db/client";
import { photoDevelopments, photoPosts, photos } from "~/db/schema";
import { versionLabel } from "~/lib/photo-versions";

function buildJpegAssetUrl(photoId: string): string {
  return `/api/v1/photos/${photoId}/asset/jpeg`;
}

function buildThumbAssetUrl(photoId: string, thumbKey: string | null): string | null {
  return thumbKey ? `/api/v1/photos/${photoId}/asset/thumb` : null;
}

function buildRawAssetUrl(photoId: string, hasRaw: boolean): string | null {
  return hasRaw ? `/api/v1/photos/${photoId}/asset/raw` : null;
}

function buildDevelopmentAssetUrl(photoId: string, developmentId: string): string {
  return `/api/v1/photos/${photoId}/developments/${developmentId}/asset`;
}

function toDevelopmentItem(row: typeof photoDevelopments.$inferSelect): PhotoDevelopmentItem {
  return {
    id: row.id,
    photoId: row.photoId,
    format: row.format,
    label: row.label,
    url: buildDevelopmentAssetUrl(row.photoId, row.id),
    sha256: row.sha256,
    byteSize: row.byteSize,
    width: row.width,
    height: row.height,
    blurhash: row.blurhash,
    isFavorite: row.isFavorite,
    developedAt: row.developedAt,
    createdAt: row.createdAt,
  };
}

/** Lowercase hex SHA-256, the form `Sha256HexSchema` accepts. */
export async function sha256Hex(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Seeds the ID with the photo as well as the file: the same file can be a version
 * of several photos, and a hash of the file alone would collide on the primary key.
 */
async function deriveDevelopmentId(
  photoId: string,
  developedAt: number,
  fileSha256: string,
): Promise<string> {
  const seed = await sha256Hex(new TextEncoder().encode(`${photoId}:${fileSha256}`));
  return uuidv7FromExifTimestamp(developedAt, seed);
}

/**
 * Splits an array into chunks of specified size.
 * Used to stay safely below Cloudflare D1's 100-parameter limit per SQL query.
 */
function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function checkExistingPhotos(
  db: AppDatabase,
  userId: string,
  hashes: string[],
): Promise<CheckedPhotoStatus[]> {
  if (hashes.length === 0) return [];

  // Cloudflare D1 has a hard limit of 100 bound parameters per query.
  // We chunk hashes into batches of 60 to safely stay within D1 limits (1 param for userId + 60 for hashes = 61).
  const hashChunks = chunkArray(hashes, 60);
  const matchedPhotos: {
    id: string;
    jpegSha256: string;
    hasRaw: boolean;
    isFavorite: boolean;
  }[] = [];

  for (const chunk of hashChunks) {
    const rows = await db
      .select({
        id: photos.id,
        jpegSha256: photos.jpegSha256,
        hasRaw: photos.hasRaw,
        isFavorite: photos.isFavorite,
      })
      .from(photos)
      .where(and(eq(photos.userId, userId), inArray(photos.jpegSha256, chunk)));
    matchedPhotos.push(...rows);
  }

  if (matchedPhotos.length === 0) return [];

  const photoIds = matchedPhotos.map((p) => p.id);
  const idChunks = chunkArray(photoIds, 60);
  const devMap = new Map<string, string[]>();

  for (const chunk of idChunks) {
    const devs = await db
      .select({
        photoId: photoDevelopments.photoId,
        sha256: photoDevelopments.sha256,
      })
      .from(photoDevelopments)
      .where(inArray(photoDevelopments.photoId, chunk));

    for (const dev of devs) {
      const list = devMap.get(dev.photoId) ?? [];
      list.push(dev.sha256);
      devMap.set(dev.photoId, list);
    }
  }

  return matchedPhotos.map((p) => ({
    photoId: p.id,
    jpegSha256: p.jpegSha256,
    hasRaw: p.hasRaw,
    isFavorite: p.isFavorite,
    developmentHashes: devMap.get(p.id) ?? [],
  }));
}

export async function upsertPhotoRecord(
  db: AppDatabase,
  userId: string,
  metadata: UploadPhotoMetadata,
  hasThumbnail: boolean,
): Promise<{
  photoId: string;
  jpegKey: string;
  thumbKey: string | null;
  detail: ApiPhotoDetail;
}> {
  // Check if user already uploaded a photo with this jpegSha256
  const existingByHash = await db
    .select()
    .from(photos)
    .where(and(eq(photos.userId, userId), eq(photos.jpegSha256, metadata.jpegSha256)))
    .limit(1);

  const photoId =
    existingByHash[0]?.id ?? uuidv7FromExifTimestamp(metadata.exif.takenAt, metadata.jpegSha256);

  const jpegKey = r2Keys.originalJpeg(userId, photoId);
  const thumbKey = hasThumbnail ? r2Keys.thumbnail(userId, photoId) : null;
  const now = Date.now();

  if (existingByHash[0]) {
    await db
      .update(photos)
      .set({
        originalFilename: metadata.originalFilename,
        takenAt: metadata.exif.takenAt,
        timezoneOffset: metadata.exif.timezoneOffset,
        jpegKey,
        thumbKey: thumbKey ?? existingByHash[0].thumbKey,
        jpegByteSize: metadata.jpegByteSize,
        width: metadata.width,
        height: metadata.height,
        blurhash: metadata.blurhash ?? existingByHash[0].blurhash,
        isFavorite: metadata.isFavorite || existingByHash[0].isFavorite,
        cameraMake: metadata.exif.cameraMake,
        cameraModel: metadata.exif.cameraModel,
        lensModel: metadata.exif.lensModel,
        focalLengthMm: metadata.exif.focalLengthMm,
        fNumber: metadata.exif.fNumber,
        exposureTime: metadata.exif.exposureTime,
        iso: metadata.exif.iso,
        exifJson: metadata.exif.exifJson,
        description: metadata.description ?? existingByHash[0].description,
        updatedAt: now,
      })
      .where(eq(photos.id, photoId));
  } else {
    await db.insert(photos).values({
      id: photoId,
      userId,
      originalFilename: metadata.originalFilename,
      takenAt: metadata.exif.takenAt,
      timezoneOffset: metadata.exif.timezoneOffset,
      jpegKey,
      thumbKey,
      jpegSha256: metadata.jpegSha256,
      jpegByteSize: metadata.jpegByteSize,
      width: metadata.width,
      height: metadata.height,
      blurhash: metadata.blurhash,
      isFavorite: metadata.isFavorite,
      hasRaw: false,
      cameraMake: metadata.exif.cameraMake,
      cameraModel: metadata.exif.cameraModel,
      lensModel: metadata.exif.lensModel,
      focalLengthMm: metadata.exif.focalLengthMm,
      fNumber: metadata.exif.fNumber,
      exposureTime: metadata.exif.exposureTime,
      iso: metadata.exif.iso,
      exifJson: metadata.exif.exifJson,
      description: metadata.description,
      createdAt: now,
      updatedAt: now,
    });
  }

  const detail = await getPhotoDetailById(db, userId, photoId);
  if (!detail) {
    throw new Error(`Failed to load photo ${photoId} after upsert`);
  }

  return { photoId, jpegKey, thumbKey, detail };
}

export async function attachRawToPhotoRecord(
  db: AppDatabase,
  userId: string,
  photoId: string,
  metadata: UploadRawMetadata,
): Promise<{ rawKey: string; detail: ApiPhotoDetail } | null> {
  const existing = await db
    .select()
    .from(photos)
    .where(and(eq(photos.id, photoId), eq(photos.userId, userId)))
    .limit(1);

  if (!existing[0]) return null;

  const rawKey = r2Keys.rawArw(userId, photoId, metadata.originalFilename);
  const now = Date.now();

  await db
    .update(photos)
    .set({
      hasRaw: true,
      rawKey,
      rawSha256: metadata.rawSha256,
      rawByteSize: metadata.rawByteSize,
      updatedAt: now,
    })
    .where(eq(photos.id, photoId));

  const detail = await getPhotoDetailById(db, userId, photoId);
  if (!detail) return null;

  return { rawKey, detail };
}

export type AddDevelopmentResult =
  | { status: "stored"; item: PhotoDevelopmentItem }
  | { status: "photo_not_found" }
  | { status: "format_mismatch"; format: DevelopedFormat };

/**
 * Adds a developed variant, or refreshes the existing one with the same file hash.
 * `storeFile` runs before any row is written, so a failed write leaves the database untouched.
 * The refresh keeps the row's ID, which is what posts refer to, and its favorite flag. It needs the
 * file, and the file's format: both decide where the row's R2 object is. Metadata alone leaves an
 * existing row as it is.
 */
export async function addDevelopmentToPhotoRecord(
  db: AppDatabase,
  userId: string,
  photoId: string,
  metadata: UploadDevelopmentMetadata,
  storeFile?: (r2Key: string) => Promise<void>,
): Promise<AddDevelopmentResult> {
  const existingPhoto = await db
    .select({ id: photos.id })
    .from(photos)
    .where(and(eq(photos.id, photoId), eq(photos.userId, userId)))
    .limit(1);

  if (!existingPhoto[0]) return { status: "photo_not_found" };

  const existingRows = await db
    .select()
    .from(photoDevelopments)
    .where(
      and(eq(photoDevelopments.photoId, photoId), eq(photoDevelopments.sha256, metadata.sha256)),
    )
    .limit(1);
  const existingDev = existingRows[0];

  if (existingDev && !storeFile) {
    return { status: "stored", item: toDevelopmentItem(existingDev) };
  }
  if (existingDev && existingDev.format !== metadata.format) {
    return { status: "format_mismatch", format: existingDev.format };
  }

  const now = Date.now();
  const developedAt = metadata.developedAt ?? now;
  const devId =
    existingDev?.id ?? (await deriveDevelopmentId(photoId, developedAt, metadata.sha256));
  const r2Key = r2Keys.development(userId, photoId, devId, metadata.format);

  await storeFile?.(r2Key);

  const values = {
    format: metadata.format,
    label: metadata.label,
    r2Key,
    byteSize: metadata.byteSize,
    width: metadata.width,
    height: metadata.height,
    blurhash: metadata.blurhash ?? existingDev?.blurhash ?? null,
    developedAt,
  };

  if (existingDev) {
    await db.update(photoDevelopments).set(values).where(eq(photoDevelopments.id, devId));
  } else {
    await db.insert(photoDevelopments).values({
      ...values,
      id: devId,
      userId,
      photoId,
      sha256: metadata.sha256,
      createdAt: now,
    });
  }

  await db.update(photos).set({ updatedAt: now }).where(eq(photos.id, photoId));

  return {
    status: "stored",
    item: toDevelopmentItem({
      ...values,
      id: devId,
      userId,
      photoId,
      sha256: metadata.sha256,
      isFavorite: existingDev?.isFavorite ?? false,
      createdAt: existingDev?.createdAt ?? now,
    }),
  };
}

/** Sets a version's favorite flag. It never touches `photos.isFavorite`. */
export async function updateDevelopmentRecord(
  db: AppDatabase,
  userId: string,
  photoId: string,
  developmentId: string,
  input: UpdateDevelopmentRequest,
): Promise<PhotoDevelopmentItem | null> {
  const rows = await db
    .select()
    .from(photoDevelopments)
    .where(
      and(
        eq(photoDevelopments.id, developmentId),
        eq(photoDevelopments.photoId, photoId),
        eq(photoDevelopments.userId, userId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (input.isFavorite === undefined) return toDevelopmentItem(row);

  await db
    .update(photoDevelopments)
    .set({ isFavorite: input.isFavorite })
    .where(eq(photoDevelopments.id, developmentId));
  await db.update(photos).set({ updatedAt: Date.now() }).where(eq(photos.id, photoId));

  return toDevelopmentItem({ ...row, isFavorite: input.isFavorite });
}

export interface DeletedDevelopment {
  deletedVersionLabel: string;
  updatedAt: number;
}

/**
 * Deletes a version: its file, then its row. Each step can be repeated, so when one fails the row
 * survives and deleting again finishes the job, rather than leaving a file nothing points to.
 *
 * Posts stay, since they exist on the platform whether or not the version does. The foreign key
 * clears their `developmentId`, and a null there means "of the original", so they keep the deleted
 * version's name to say otherwise.
 */
export async function deleteDevelopmentRecord(
  db: AppDatabase,
  userId: string,
  photoId: string,
  developmentId: string,
  removeFile: (r2Key: string) => Promise<void>,
): Promise<DeletedDevelopment | null> {
  const rows = await db
    .select()
    .from(photoDevelopments)
    .where(
      and(
        eq(photoDevelopments.id, developmentId),
        eq(photoDevelopments.photoId, photoId),
        eq(photoDevelopments.userId, userId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  await removeFile(row.r2Key);

  const deletedVersionLabel = versionLabel(row);
  const updatedAt = Date.now();
  // One transaction, so a post added meanwhile can't lose its version without getting the name.
  await db.batch([
    db
      .update(photoPosts)
      .set({ deletedVersionLabel })
      .where(eq(photoPosts.developmentId, developmentId)),
    db.delete(photoDevelopments).where(eq(photoDevelopments.id, developmentId)),
    db.update(photos).set({ updatedAt }).where(eq(photos.id, photoId)),
  ]);

  return { deletedVersionLabel, updatedAt };
}

/**
 * Deletes a photo and all of its stored assets. Files are removed before the cascading database
 * delete so a storage failure leaves the photo record available for a safe retry.
 */
export async function deletePhotoRecord(
  db: AppDatabase,
  userId: string,
  photoId: string,
  removeFile: (r2Key: string) => Promise<void>,
): Promise<boolean> {
  const rows = await db
    .select()
    .from(photos)
    .where(and(eq(photos.id, photoId), eq(photos.userId, userId)))
    .limit(1);
  const photo = rows[0];
  if (!photo) return false;

  const developments = await db
    .select({ r2Key: photoDevelopments.r2Key })
    .from(photoDevelopments)
    .where(and(eq(photoDevelopments.photoId, photoId), eq(photoDevelopments.userId, userId)));

  for (const key of [
    photo.jpegKey,
    photo.thumbKey,
    photo.rawKey,
    ...developments.map((d) => d.r2Key),
  ]) {
    if (key) await removeFile(key);
  }
  await db.batch([
    db.delete(photoPosts).where(eq(photoPosts.photoId, photoId)),
    db
      .delete(photoDevelopments)
      .where(and(eq(photoDevelopments.photoId, photoId), eq(photoDevelopments.userId, userId))),
    db.delete(photos).where(and(eq(photos.id, photoId), eq(photos.userId, userId))),
  ]);
  return true;
}

export type AddPostResult =
  | { status: "created"; post: PhotoPostItem }
  | { status: "photo_not_found" }
  | { status: "development_not_found" };

export async function addPostToPhotoRecord(
  db: AppDatabase,
  userId: string,
  photoId: string,
  input: CreatePhotoPostRequest,
): Promise<AddPostResult> {
  const existingPhoto = await db
    .select({ id: photos.id })
    .from(photos)
    .where(and(eq(photos.id, photoId), eq(photos.userId, userId)))
    .limit(1);

  if (!existingPhoto[0]) return { status: "photo_not_found" };

  const developmentId = input.developmentId ?? null;
  if (developmentId !== null) {
    const development = await db
      .select({ id: photoDevelopments.id })
      .from(photoDevelopments)
      .where(
        and(
          eq(photoDevelopments.id, developmentId),
          eq(photoDevelopments.photoId, photoId),
          eq(photoDevelopments.userId, userId),
        ),
      )
      .limit(1);

    if (!development[0]) return { status: "development_not_found" };
  }

  const now = Date.now();
  const postedAt = input.postedAt ?? now;
  const postId = uuidv7(now);

  await db.insert(photoPosts).values({
    id: postId,
    userId,
    photoId,
    developmentId,
    platform: input.platform,
    postUrl: input.postUrl,
    externalPostId: input.externalPostId ?? null,
    caption: input.caption ?? null,
    postedAt,
    createdAt: now,
  });

  await db.update(photos).set({ updatedAt: now }).where(eq(photos.id, photoId));

  return {
    status: "created",
    post: {
      id: postId,
      photoId,
      developmentId,
      deletedVersionLabel: null,
      platform: input.platform,
      postUrl: input.postUrl,
      externalPostId: input.externalPostId ?? null,
      caption: input.caption ?? null,
      postedAt,
      createdAt: now,
    },
  };
}

export async function deletePhotoPostRecord(
  db: AppDatabase,
  userId: string,
  photoId: string,
  postId: string,
): Promise<boolean> {
  const existing = await db
    .select({ id: photoPosts.id })
    .from(photoPosts)
    .where(
      and(
        eq(photoPosts.id, postId),
        eq(photoPosts.photoId, photoId),
        eq(photoPosts.userId, userId),
      ),
    )
    .limit(1);

  if (!existing[0]) return false;

  await db.delete(photoPosts).where(eq(photoPosts.id, postId));
  return true;
}

export async function updatePhotoRecord(
  db: AppDatabase,
  userId: string,
  photoId: string,
  input: UpdatePhotoRequest,
): Promise<ApiPhotoDetail | null> {
  const existing = await db
    .select()
    .from(photos)
    .where(and(eq(photos.id, photoId), eq(photos.userId, userId)))
    .limit(1);

  if (!existing[0]) return null;

  const updates: Partial<typeof photos.$inferInsert> = {
    updatedAt: Date.now(),
  };
  if (input.isFavorite !== undefined) {
    updates.isFavorite = input.isFavorite;
  }
  if (input.description !== undefined) {
    updates.description = input.description;
  }

  await db.update(photos).set(updates).where(eq(photos.id, photoId));
  return getPhotoDetailById(db, userId, photoId);
}

export async function getPhotoDetailById(
  db: AppDatabase,
  userId: string,
  photoId: string,
): Promise<ApiPhotoDetail | null> {
  const rows = await db
    .select()
    .from(photos)
    .where(and(eq(photos.id, photoId), eq(photos.userId, userId)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const developments = await db
    .select()
    .from(photoDevelopments)
    .where(eq(photoDevelopments.photoId, photoId))
    .orderBy(desc(photoDevelopments.developedAt));

  const posts = await db
    .select()
    .from(photoPosts)
    .where(eq(photoPosts.photoId, photoId))
    .orderBy(desc(photoPosts.postedAt));

  const platforms = Array.from(new Set(posts.map((p) => p.platform)));

  return {
    id: row.id,
    userId: row.userId,
    originalFilename: row.originalFilename,
    takenAt: row.takenAt,
    timezoneOffset: row.timezoneOffset,
    jpegUrl: buildJpegAssetUrl(row.id),
    thumbUrl: buildThumbAssetUrl(row.id, row.thumbKey),
    jpegSha256: row.jpegSha256,
    jpegByteSize: row.jpegByteSize,
    width: row.width,
    height: row.height,
    blurhash: row.blurhash,
    isFavorite: row.isFavorite,
    hasRaw: row.hasRaw,
    rawUrl: buildRawAssetUrl(row.id, row.hasRaw),
    rawByteSize: row.rawByteSize,
    cameraMake: row.cameraMake,
    cameraModel: row.cameraModel,
    lensModel: row.lensModel,
    focalLengthMm: row.focalLengthMm,
    fNumber: row.fNumber,
    exposureTime: row.exposureTime,
    iso: row.iso,
    exifJson: row.exifJson ?? null,
    description: row.description,
    developmentsCount: developments.length,
    favoriteDevelopmentsCount: developments.filter((d) => d.isFavorite).length,
    postsCount: posts.length,
    platforms,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    developments: developments.map(toDevelopmentItem),
    posts: posts.map((p) => ({
      id: p.id,
      photoId: p.photoId,
      developmentId: p.developmentId,
      deletedVersionLabel: p.deletedVersionLabel,
      platform: p.platform,
      postUrl: p.postUrl,
      externalPostId: p.externalPostId,
      caption: p.caption,
      postedAt: p.postedAt,
      createdAt: p.createdAt,
    })),
  };
}

interface ListCursor {
  takenAt: number;
  /** Null for the bare timestamp cursors that older CLI builds may still send. */
  id: string | null;
}

/** Reads `<takenAt>_<id>` or a bare `<takenAt>`. Malformed cursors are ignored. */
function parseListCursor(cursor: string | undefined): ListCursor | null {
  if (!cursor) return null;
  const compound = /^(-?\d+)_(.+)$/.exec(cursor);
  if (compound?.[1] && compound[2]) {
    return { takenAt: Number(compound[1]), id: compound[2] };
  }
  const takenAt = Number(cursor);
  return Number.isFinite(takenAt) ? { takenAt, id: null } : null;
}

/** Mirrors the list order, `takenAt` then `id`, both descending. */
function isAfterCursor(photo: { takenAt: number; id: string }, cursor: ListCursor): boolean {
  if (photo.takenAt !== cursor.takenAt) return photo.takenAt < cursor.takenAt;
  return cursor.id !== null && photo.id < cursor.id;
}

export async function listPhotosForUser(
  db: AppDatabase,
  userId: string,
  query: ListPhotosQuery,
): Promise<ListPhotosResponse> {
  // Fetch all user photos for facet computation & filtering
  const allUserPhotos = await db
    .select()
    .from(photos)
    .where(eq(photos.userId, userId))
    .orderBy(desc(photos.takenAt), desc(photos.id));

  // Filtering by owner keeps this at one query each, however large the library is.
  const devRows = await db
    .select({ photoId: photoDevelopments.photoId, isFavorite: photoDevelopments.isFavorite })
    .from(photoDevelopments)
    .where(eq(photoDevelopments.userId, userId));

  const postRows = await db
    .select({ photoId: photoPosts.photoId, platform: photoPosts.platform })
    .from(photoPosts)
    .where(eq(photoPosts.userId, userId));

  const devCountByPhoto = new Map<string, number>();
  const favDevCountByPhoto = new Map<string, number>();
  for (const dev of devRows) {
    devCountByPhoto.set(dev.photoId, (devCountByPhoto.get(dev.photoId) ?? 0) + 1);
    if (dev.isFavorite) {
      favDevCountByPhoto.set(dev.photoId, (favDevCountByPhoto.get(dev.photoId) ?? 0) + 1);
    }
  }

  const platformsByPhoto = new Map<string, Set<SocialPlatform>>();
  const postCountByPhoto = new Map<string, number>();
  for (const post of postRows) {
    postCountByPhoto.set(post.photoId, (postCountByPhoto.get(post.photoId) ?? 0) + 1);
    const set = platformsByPhoto.get(post.photoId) ?? new Set<SocialPlatform>();
    set.add(post.platform);
    platformsByPhoto.set(post.photoId, set);
  }

  // Compute facets across all user photos
  const lensCounts = new Map<string, number>();
  const monthCounts = new Map<string, number>();
  const dateCountsByMonth = new Map<string, Map<string, number>>();
  let favoriteCount = 0;
  let developedCount = 0;
  let favoriteDevelopedCount = 0;
  let rawCount = 0;

  for (const p of allUserPhotos) {
    if (p.lensModel) {
      lensCounts.set(p.lensModel, (lensCounts.get(p.lensModel) ?? 0) + 1);
    }
    const dateStr = formatCaptureDate(p.takenAt, p.timezoneOffset);
    const monthStr = dateStr.slice(0, 7);
    monthCounts.set(monthStr, (monthCounts.get(monthStr) ?? 0) + 1);
    let dateMap = dateCountsByMonth.get(monthStr);
    if (!dateMap) {
      dateMap = new Map<string, number>();
      dateCountsByMonth.set(monthStr, dateMap);
    }
    dateMap.set(dateStr, (dateMap.get(dateStr) ?? 0) + 1);

    if (p.isFavorite) favoriteCount++;
    if (p.hasRaw) rawCount++;
    if ((devCountByPhoto.get(p.id) ?? 0) > 0) developedCount++;
    if ((favDevCountByPhoto.get(p.id) ?? 0) > 0) favoriteDevelopedCount++;
  }

  // Apply query filters
  const matching = allUserPhotos.filter((p) => {
    if (query.lens && p.lensModel !== query.lens) return false;
    if (
      query.minFocal !== undefined &&
      (p.focalLengthMm === null || p.focalLengthMm < query.minFocal)
    ) {
      return false;
    }
    if (
      query.maxFocal !== undefined &&
      (p.focalLengthMm === null || p.focalLengthMm > query.maxFocal)
    ) {
      return false;
    }
    if (query.favorite === "true" && !p.isFavorite) return false;
    if (query.favorite === "false" && p.isFavorite) return false;
    if (query.hasRaw === "true" && !p.hasRaw) return false;
    if (query.hasRaw === "false" && p.hasRaw) return false;

    const devCount = devCountByPhoto.get(p.id) ?? 0;
    if (query.hasDeveloped === "true" && devCount === 0) return false;
    if (query.hasDeveloped === "false" && devCount > 0) return false;

    const favDevCount = favDevCountByPhoto.get(p.id) ?? 0;
    if (query.hasFavoriteDevelopment === "true" && favDevCount === 0) return false;
    if (query.hasFavoriteDevelopment === "false" && favDevCount > 0) return false;

    if (query.platform) {
      const platforms = platformsByPhoto.get(p.id);
      if (!platforms?.has(query.platform)) return false;
    }

    if (query.month || query.date) {
      const dateStr = formatCaptureDate(p.takenAt, p.timezoneOffset);
      if (query.month && dateStr.slice(0, 7) !== query.month) return false;
      if (query.date && dateStr !== query.date) return false;
    }

    if (query.search) {
      const q = query.search.toLowerCase();
      const matchFilename = p.originalFilename.toLowerCase().includes(q);
      const matchLens = (p.lensModel ?? "").toLowerCase().includes(q);
      const matchDesc = (p.description ?? "").toLowerCase().includes(q);
      const matchId = p.id.toLowerCase().includes(q);
      if (!matchFilename && !matchLens && !matchDesc && !matchId) return false;
    }

    return true;
  });

  const cursor = parseListCursor(query.cursor);
  const remaining = cursor ? matching.filter((p) => isAfterCursor(p, cursor)) : matching;

  const limit = query.limit ?? 60;
  const page = remaining.slice(0, limit);
  const lastRow = page[page.length - 1];
  const nextCursor =
    remaining.length > limit && lastRow ? `${lastRow.takenAt}_${lastRow.id}` : null;

  const summaries: ApiPhotoSummary[] = page.map((row) => ({
    id: row.id,
    userId: row.userId,
    originalFilename: row.originalFilename,
    takenAt: row.takenAt,
    timezoneOffset: row.timezoneOffset,
    jpegUrl: buildJpegAssetUrl(row.id),
    thumbUrl: buildThumbAssetUrl(row.id, row.thumbKey),
    jpegSha256: row.jpegSha256,
    jpegByteSize: row.jpegByteSize,
    width: row.width,
    height: row.height,
    blurhash: row.blurhash,
    isFavorite: row.isFavorite,
    hasRaw: row.hasRaw,
    rawUrl: buildRawAssetUrl(row.id, row.hasRaw),
    rawByteSize: row.rawByteSize,
    cameraMake: row.cameraMake,
    cameraModel: row.cameraModel,
    lensModel: row.lensModel,
    focalLengthMm: row.focalLengthMm,
    fNumber: row.fNumber,
    exposureTime: row.exposureTime,
    iso: row.iso,
    exifJson: row.exifJson ?? null,
    description: row.description,
    developmentsCount: devCountByPhoto.get(row.id) ?? 0,
    favoriteDevelopmentsCount: favDevCountByPhoto.get(row.id) ?? 0,
    postsCount: postCountByPhoto.get(row.id) ?? 0,
    platforms: Array.from(platformsByPhoto.get(row.id) ?? []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));

  return {
    photos: summaries,
    nextCursor,
    matchedCount: matching.length,
    facets: {
      lenses: Array.from(lensCounts.entries())
        .map(([lensModel, count]) => ({ lensModel, count }))
        .sort((a, b) => b.count - a.count),
      months: Array.from(monthCounts.entries())
        .map(([month, count]) => ({
          month,
          count,
          dates: Array.from(dateCountsByMonth.get(month)?.entries() ?? [])
            .map(([date, dateCount]) => ({ date, count: dateCount }))
            .sort((a, b) => a.date.localeCompare(b.date)),
        }))
        .sort((a, b) => b.month.localeCompare(a.month)),
      totalCount: allUserPhotos.length,
      favoriteCount,
      developedCount,
      favoriteDevelopedCount,
      rawCount,
    },
  };
}

function formatCaptureDate(takenAtMs: number, timezoneOffset: string): string {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(timezoneOffset);
  let offsetMinutes = 9 * 60;
  if (match) {
    const sign = match[1] === "-" ? -1 : 1;
    offsetMinutes = sign * (Number(match[2]) * 60 + Number(match[3]));
  }
  const localDate = new Date(takenAtMs + offsetMinutes * 60_000);
  const year = localDate.getUTCFullYear();
  const month = String(localDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(localDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
