import { createHash } from "node:crypto";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { uuidv7FromExifTimestamp } from "@omoide/core";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "~/db/client";
import * as schema from "~/db/schema";
import { resolveRequestOrigin } from "~/server/auth";
import { createApiApp } from "./handler";

function createTestDatabase(): AppDatabase {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE user (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      email_verified INTEGER DEFAULT 0 NOT NULL,
      image TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE session (
      id TEXT PRIMARY KEY NOT NULL,
      expires_at INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
    );
    CREATE TABLE account (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      access_token TEXT,
      refresh_token TEXT,
      id_token TEXT,
      access_token_expires_at INTEGER,
      refresh_token_expires_at INTEGER,
      scope TEXT,
      password TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE verification (
      id TEXT PRIMARY KEY NOT NULL,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE apikey (
      id TEXT PRIMARY KEY NOT NULL,
      config_id TEXT DEFAULT 'default' NOT NULL,
      name TEXT,
      start TEXT,
      reference_id TEXT NOT NULL,
      prefix TEXT,
      key TEXT NOT NULL,
      refill_interval INTEGER,
      refill_amount INTEGER,
      last_refill_at INTEGER,
      enabled INTEGER DEFAULT 1,
      rate_limit_enabled INTEGER DEFAULT 1,
      rate_limit_time_window INTEGER DEFAULT 86400000,
      rate_limit_max INTEGER DEFAULT 10,
      request_count INTEGER DEFAULT 0,
      remaining INTEGER,
      last_request INTEGER,
      expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      permissions TEXT,
      metadata TEXT
    );
    CREATE TABLE photos (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      original_filename TEXT NOT NULL,
      taken_at INTEGER NOT NULL,
      timezone_offset TEXT DEFAULT '+09:00' NOT NULL,
      jpeg_key TEXT NOT NULL,
      thumb_key TEXT,
      jpeg_sha256 TEXT NOT NULL,
      jpeg_byte_size INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      blurhash TEXT,
      is_favorite INTEGER DEFAULT 0 NOT NULL,
      has_raw INTEGER DEFAULT 0 NOT NULL,
      raw_key TEXT,
      raw_sha256 TEXT,
      raw_byte_size INTEGER,
      camera_make TEXT DEFAULT 'SONY',
      camera_model TEXT DEFAULT 'ILCE-7C',
      lens_model TEXT,
      focal_length_mm REAL,
      f_number REAL,
      exposure_time TEXT,
      iso INTEGER,
      exif_json TEXT,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE photo_developments (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      format TEXT NOT NULL,
      label TEXT DEFAULT 'default' NOT NULL,
      r2_key TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      blurhash TEXT,
      is_favorite INTEGER DEFAULT 0 NOT NULL,
      developed_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE photo_posts (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      development_id TEXT REFERENCES photo_developments(id) ON DELETE SET NULL,
      deleted_version_label TEXT,
      platform TEXT NOT NULL,
      post_url TEXT NOT NULL,
      external_post_id TEXT,
      caption TEXT,
      posted_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  type Method = "run" | "all" | "values" | "get";

  function execute(sql: string, params: unknown[] | undefined, method: Method) {
    const stmt = sqlite.prepare(sql);
    stmt.setReturnArrays(true);
    const boundParams = (params ?? []).map((p) =>
      typeof p === "boolean" ? (p ? 1 : 0) : p,
    ) as SQLInputValue[];
    if (method === "run") {
      stmt.run(...boundParams);
      return { rows: [] as unknown[] };
    }
    const rows = stmt.all(...boundParams) as unknown as unknown[][];
    if (method === "get") {
      return { rows: (rows[0] ?? []) as unknown[] };
    }
    return { rows: rows as unknown[] };
  }

  return drizzle(
    async (sql, params, method) => execute(sql, params, method),
    // A transaction, as D1's batch is.
    async (queries) => {
      sqlite.exec("BEGIN");
      try {
        const results = queries.map((q) => execute(q.sql, q.params, q.method));
        sqlite.exec("COMMIT");
        return results;
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    },
    { schema },
  ) as unknown as AppDatabase;
}

function createMockR2Bucket() {
  const store = new Map<string, { body: ArrayBuffer; contentType: string }>();
  return {
    store,
    bucket: {
      async put(
        key: string,
        body: ArrayBuffer | Uint8Array | string,
        options?: { httpMetadata?: { contentType?: string } },
      ) {
        const buf =
          body instanceof ArrayBuffer
            ? body
            : body instanceof Uint8Array
              ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
              : new TextEncoder().encode(String(body)).buffer;
        store.set(key, {
          body: buf as ArrayBuffer,
          contentType: options?.httpMetadata?.contentType ?? "application/octet-stream",
        });
      },
      async delete(key: string) {
        store.delete(key);
      },
      async get(key: string) {
        const entry = store.get(key);
        if (!entry) return null;
        return {
          body: entry.body,
          httpEtag: '"mock-etag"',
          writeHttpMetadata(headers: Headers) {
            headers.set("content-type", entry.contentType);
          },
        };
      },
    } as unknown as R2Bucket,
  };
}

describe("Omoide REST API (@omoide/web)", () => {
  let db: AppDatabase;
  let mockR2: ReturnType<typeof createMockR2Bucket>;
  let env: Env;
  let app: ReturnType<typeof createApiApp>;

  beforeEach(() => {
    db = createTestDatabase();
    mockR2 = createMockR2Bucket();
    env = {
      DB: {} as D1Database,
      PHOTOS_BUCKET: mockR2.bucket,
      BETTER_AUTH_SECRET: "test-secret-key-for-omoide-1234567890",
      ALLOWED_USERS: "nikomaru",
    };
    app = createApiApp({ customDb: db });
  });

  it("issues an omod_... CLI API key and authenticates subsequent requests", async () => {
    const createKeyRes = await app.request(
      "/api/v1/api-keys",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "windows-cli" }),
      },
      env,
    );
    expect(createKeyRes.status).toBe(201);
    const createdKey = (await createKeyRes.json()) as {
      id: string;
      key: string;
    };
    expect(createdKey.key.startsWith("omod_")).toBe(true);

    // Use the issued omod_ key via Authorization: Bearer
    const meRes = await app.request(
      "/api/v1/me",
      {
        headers: { authorization: `Bearer ${createdKey.key}` },
      },
      env,
    );
    expect(meRes.status).toBe(200);
    const meBody = (await meRes.json()) as {
      actor: { authMethod: string; userId: string };
    };
    expect(meBody.actor.authMethod).toBe("api_key");
  });

  it("uploads a Sony a7C JPEG, attaches 1:1 .ARW RAW, 1:N developed variants, and 1:N social posts", async () => {
    const jpegSha256 = "a3f5c8e9b2d104765891a3f5c8e9b2d104765891a3f5c8e9b2d104765891a3f5";
    const takenAt = Date.parse("2026-11-03T08:31:47+09:00");
    const expectedPhotoId = uuidv7FromExifTimestamp(takenAt, jpegSha256);

    // 1. Upload Base JPEG
    const uploadRes = await app.request(
      "/api/v1/photos",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          metadata: {
            originalFilename: "DSC03367.JPG",
            jpegSha256,
            jpegByteSize: 13_021_884,
            width: 6000,
            height: 4000,
            blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
            isFavorite: false,
            exif: {
              takenAt,
              timezoneOffset: "+09:00",
              cameraMake: "SONY",
              cameraModel: "ILCE-7C",
              lensModel: "28-70mm F2.8 DG DN | Contemporary 021",
              focalLengthMm: 61.1,
              fNumber: 4.5,
              exposureTime: "1/160",
              iso: 800,
              exifJson: {
                focalLength35mm: 61,
                exposureCompensation: 0,
              },
            },
          },
          jpegBase64: btoa("fake-jpeg-binary"),
        }),
      },
      env,
    );

    expect(uploadRes.status).toBe(201);
    const uploaded = (await uploadRes.json()) as {
      photoId: string;
      photo: { id: string; lensModel: string };
    };
    expect(uploaded.photoId).toBe(expectedPhotoId);

    // 2. Check existing hash via /api/v1/photos/check
    const checkRes = await app.request(
      "/api/v1/photos/check",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hashes: [jpegSha256] }),
      },
      env,
    );
    expect(checkRes.status).toBe(200);
    const checked = (await checkRes.json()) as {
      items: Array<{ photoId: string; hasRaw: boolean }>;
    };
    expect(checked.items).toHaveLength(1);
    expect(checked.items[0]?.photoId).toBe(expectedPhotoId);
    expect(checked.items[0]?.hasRaw).toBe(false);

    // 2b. Check that batch checking 500 hashes does not fail Cloudflare D1's 100-parameter limit
    const largeHashBatch = Array.from({ length: 500 }, (_, i) =>
      i === 0 ? jpegSha256 : `${i.toString(16).padStart(64, "0")}`,
    );
    const largeCheckRes = await app.request(
      "/api/v1/photos/check",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hashes: largeHashBatch }),
      },
      env,
    );
    expect(largeCheckRes.status).toBe(200);
    const largeChecked = (await largeCheckRes.json()) as {
      items: Array<{ photoId: string }>;
    };
    expect(largeChecked.items).toHaveLength(1);
    expect(largeChecked.items[0]?.photoId).toBe(expectedPhotoId);

    // 3. Attach 1:1 Sony .ARW RAW
    const rawSha256 = "b4e6d9f0c3e215876902b4e6d9f0c3e215876902b4e6d9f0c3e215876902b4e6";
    const rawRes = await app.request(
      `/api/v1/photos/${expectedPhotoId}/raw`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rawSha256,
          rawByteSize: 51_589_952,
          originalFilename: "DSC03367.ARW",
        }),
      },
      env,
    );
    expect(rawRes.status).toBe(200);

    // 4. Upload 1:N Developed Variants (WebP + PNG)
    const devWebpSha = "c5f7e0a1d4f326987013c5f7e0a1d4f326987013c5f7e0a1d4f326987013c5f7";
    const devPngSha = "d6a8f1b2e5a437098124d6a8f1b2e5a437098124d6a8f1b2e5a437098124d6a8";

    const dev1Res = await app.request(
      `/api/v1/photos/${expectedPhotoId}/developments`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          format: "webp",
          label: "DSC03367.00000000",
          sha256: devWebpSha,
          byteSize: 2_450_112,
          width: 6000,
          height: 4000,
        }),
      },
      env,
    );
    expect(dev1Res.status).toBe(201);

    const dev2Res = await app.request(
      `/api/v1/photos/${expectedPhotoId}/developments`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          format: "png",
          label: "01-3x2-framed",
          sha256: devPngSha,
          byteSize: 18_120_000,
          width: 6000,
          height: 4000,
        }),
      },
      env,
    );
    expect(dev2Res.status).toBe(201);

    // 5. Add 1:N Social Media Posts (Instagram + Twitter/X)
    const igPostRes = await app.request(
      `/api/v1/photos/${expectedPhotoId}/posts`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          platform: "instagram",
          postUrl: "https://www.instagram.com/p/DSC03367/",
          caption: "Higashiyama Zoo on Sony a7C",
        }),
      },
      env,
    );
    expect(igPostRes.status).toBe(201);

    const xPostRes = await app.request(
      `/api/v1/photos/${expectedPhotoId}/posts`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          platform: "twitter",
          postUrl: "https://x.com/nikomaru/status/1234567890",
        }),
      },
      env,
    );
    expect(xPostRes.status).toBe(201);

    // 6. Toggle favorite via PATCH
    const patchRes = await app.request(
      `/api/v1/photos/${expectedPhotoId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isFavorite: true }),
      },
      env,
    );
    expect(patchRes.status).toBe(200);

    // 7. Verify full detail & filtered list
    const listRes = await app.request(
      "/api/v1/photos?favorite=true&hasRaw=true&hasDeveloped=true&platform=instagram",
      {},
      env,
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      photos: Array<{
        id: string;
        developmentsCount: number;
        postsCount: number;
        platforms: string[];
      }>;
      facets: {
        totalCount: number;
        favoriteCount: number;
        rawCount: number;
        developedCount: number;
      };
    };
    expect(listBody.photos).toHaveLength(1);
    expect(listBody.photos[0]?.id).toBe(expectedPhotoId);
    expect(listBody.photos[0]?.developmentsCount).toBe(2);
    expect(listBody.photos[0]?.postsCount).toBe(2);
    expect(listBody.photos[0]?.platforms).toEqual(expect.arrayContaining(["instagram", "twitter"]));
    expect(listBody.facets.totalCount).toBe(1);
    expect(listBody.facets.favoriteCount).toBe(1);
    expect(listBody.facets.rawCount).toBe(1);
    expect(listBody.facets.developedCount).toBe(1);
  });

  describe("GET /api/v1/photos paging", () => {
    const BASE_TAKEN_AT = Date.parse("2026-11-03T08:00:00+09:00");

    interface ListBody {
      photos: Array<{ id: string; takenAt: number }>;
      nextCursor: string | null;
      matchedCount: number;
      facets: { totalCount: number };
    }

    async function uploadPhoto(index: number, takenAt: number, lensModel: string) {
      const res = await app.request(
        "/api/v1/photos",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            metadata: {
              originalFilename: `DSC${String(index).padStart(5, "0")}.JPG`,
              jpegSha256: index.toString(16).repeat(64),
              jpegByteSize: 1024,
              width: 6000,
              height: 4000,
              isFavorite: false,
              exif: {
                takenAt,
                timezoneOffset: "+09:00",
                cameraMake: "SONY",
                cameraModel: "ILCE-7C",
                lensModel,
                exifJson: { focalLength35mm: 35, exposureCompensation: 0 },
              },
            },
            jpegBase64: btoa("fake-jpeg-binary"),
          }),
        },
        env,
      );
      expect(res.status).toBe(201);
    }

    /** One newer photo, five sharing a timestamp, one older: seven in total. */
    async function seedBurst() {
      await uploadPhoto(1, BASE_TAKEN_AT + 1000, "lens-a");
      for (let i = 2; i <= 6; i++) {
        await uploadPhoto(i, BASE_TAKEN_AT, i % 2 === 0 ? "lens-a" : "lens-b");
      }
      await uploadPhoto(7, BASE_TAKEN_AT - 1000, "lens-b");
    }

    async function listPage(params: Record<string, string>): Promise<ListBody> {
      const res = await app.request(`/api/v1/photos?${new URLSearchParams(params)}`, {}, env);
      expect(res.status).toBe(200);
      return (await res.json()) as ListBody;
    }

    async function listAllPages(params: Record<string, string>) {
      const pages: ListBody[] = [];
      let cursor: string | null = null;
      do {
        const page: ListBody = await listPage(cursor ? { ...params, cursor } : params);
        pages.push(page);
        cursor = page.nextCursor;
      } while (cursor !== null && pages.length < 20);
      return pages;
    }

    it("returns every photo exactly once when a page boundary splits a same-timestamp group", async () => {
      await seedBurst();

      const { photos: everything } = await listPage({ limit: "100" });
      expect(everything).toHaveLength(7);

      // A page size of 3 ends pages one and two inside the same-timestamp group.
      const pages = await listAllPages({ limit: "3" });
      expect(pages.map((page) => page.photos.length)).toEqual([3, 3, 1]);
      expect(pages[0]?.photos.at(-1)?.takenAt).toBe(BASE_TAKEN_AT);
      expect(pages[1]?.photos[0]?.takenAt).toBe(BASE_TAKEN_AT);

      const pagedIds = pages.flatMap((page) => page.photos.map((photo) => photo.id));
      expect(pagedIds).toEqual(everything.map((photo) => photo.id));
      expect(new Set(pagedIds).size).toBe(7);
    });

    it("returns a null nextCursor on the last page, including one that ends exactly on the limit", async () => {
      await seedBurst();

      expect((await listPage({ limit: "7" })).nextCursor).toBeNull();

      const pages = await listAllPages({ limit: "3" });
      expect(pages.at(-1)?.nextCursor).toBeNull();
      expect(pages.slice(0, -1).every((page) => page.nextCursor !== null)).toBe(true);
    });

    it("counts matchedCount across the filters, before the cursor and limit", async () => {
      await seedBurst();

      const unfiltered = await listAllPages({ limit: "3" });
      expect(unfiltered.map((page) => page.matchedCount)).toEqual([7, 7, 7]);

      // lens-b: photos 3 and 5 in the burst, plus the older photo 7.
      const filtered = await listAllPages({ limit: "2", lens: "lens-b" });
      expect(filtered.map((page) => page.matchedCount)).toEqual([3, 3]);
      expect(filtered.flatMap((page) => page.photos)).toHaveLength(3);
      expect(filtered[0]?.facets.totalCount).toBe(7);

      expect((await listPage({ lens: "no-such-lens" })).matchedCount).toBe(0);
    });

    it("still accepts a bare numeric cursor and ignores a malformed one", async () => {
      await seedBurst();

      const bare = await listPage({ limit: "100", cursor: String(BASE_TAKEN_AT) });
      expect(bare.photos).toHaveLength(1);
      expect(bare.photos[0]?.takenAt).toBe(BASE_TAKEN_AT - 1000);
      expect(bare.matchedCount).toBe(7);

      for (const cursor of ["not-a-cursor", "_abc", "123_"]) {
        const malformed = await listPage({ limit: "100", cursor });
        expect(malformed.photos).toHaveLength(7);
      }
    });

    it("groups date counts under each month facet and filters by exact date", async () => {
      const oct26 = Date.parse("2026-10-26T10:00:00+09:00");
      const oct27 = Date.parse("2026-10-27T14:00:00+09:00");
      await uploadPhoto(1, oct26, "lens-a");
      await uploadPhoto(2, oct27, "lens-a");
      await uploadPhoto(3, oct27 + 1000, "lens-b");

      const res = await app.request("/api/v1/photos?date=2026-10-27", {}, env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        photos: Array<{ id: string }>;
        matchedCount: number;
        facets: {
          months: Array<{
            month: string;
            count: number;
            dates: Array<{ date: string; count: number }>;
          }>;
        };
      };
      expect(body.photos).toHaveLength(2);
      expect(body.matchedCount).toBe(2);
      expect(body.facets.months).toEqual([
        {
          month: "2026-10",
          count: 3,
          dates: [
            { date: "2026-10-26", count: 1 },
            { date: "2026-10-27", count: 2 },
          ],
        },
      ]);
    });
  });

  describe("photo developments", () => {
    const TAKEN_AT = Date.parse("2026-11-03T08:00:00+09:00");
    const FOREIGN_USER_ID = "someone-else";

    interface DevelopmentBody {
      id: string;
      photoId: string;
      url: string;
      sha256: string;
      label: string;
      format: string;
      isFavorite: boolean;
    }

    interface PostBody {
      id: string;
      developmentId: string | null;
      deletedVersionLabel: string | null;
    }

    interface DetailBody {
      isFavorite: boolean;
      developmentsCount: number;
      postsCount: number;
      developments: DevelopmentBody[];
      posts: PostBody[];
    }

    function sha256Of(bytes: Uint8Array): string {
      return createHash("sha256").update(bytes).digest("hex");
    }

    function metadataFor(bytes: Uint8Array, overrides: Record<string, unknown> = {}) {
      return {
        format: "webp",
        label: "edit",
        sha256: sha256Of(bytes),
        byteSize: bytes.byteLength,
        width: 600,
        height: 400,
        blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
        developedAt: TAKEN_AT,
        ...overrides,
      };
    }

    async function createPhoto(index: number): Promise<string> {
      const res = await app.request(
        "/api/v1/photos",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            metadata: {
              originalFilename: `DSC${String(index).padStart(5, "0")}.JPG`,
              jpegSha256: index.toString(16).repeat(64),
              jpegByteSize: 1024,
              width: 6000,
              height: 4000,
              exif: { takenAt: TAKEN_AT + index, exifJson: {} },
            },
          }),
        },
        env,
      );
      expect(res.status).toBe(201);
      return ((await res.json()) as { photoId: string }).photoId;
    }

    /** Seeds a photo and a version owned by another user, bypassing the API's owner scoping. */
    async function createForeignDevelopment() {
      const now = Date.now();
      const photoId = "foreign-photo";
      const developmentId = "foreign-development";
      await db.insert(schema.user).values({
        id: FOREIGN_USER_ID,
        name: "someone",
        email: "someone@example.com",
      });
      await db.insert(schema.photos).values({
        id: photoId,
        userId: FOREIGN_USER_ID,
        originalFilename: "FOREIGN.JPG",
        takenAt: TAKEN_AT,
        jpegKey: "foreign.jpg",
        jpegSha256: "f".repeat(64),
        jpegByteSize: 1024,
        width: 6000,
        height: 4000,
        createdAt: now,
        updatedAt: now,
      });
      await db.insert(schema.photoDevelopments).values({
        id: developmentId,
        userId: FOREIGN_USER_ID,
        photoId,
        format: "webp",
        r2Key: "foreign.webp",
        sha256: "e".repeat(64),
        byteSize: 1024,
        width: 600,
        height: 400,
        developedAt: now,
        createdAt: now,
      });
      return { photoId, developmentId };
    }

    function postUpload(photoId: string, metadata: unknown, bytes?: Uint8Array) {
      const form = new FormData();
      form.append("metadata", JSON.stringify(metadata));
      if (bytes) {
        form.append("file", new Blob([bytes as BlobPart], { type: "image/webp" }), "edit.webp");
      }
      return app.request(
        `/api/v1/photos/${photoId}/developments`,
        { method: "POST", body: form },
        env,
      );
    }

    async function uploadDevelopment(
      photoId: string,
      bytes: Uint8Array,
      overrides: Record<string, unknown> = {},
    ): Promise<DevelopmentBody> {
      const res = await postUpload(photoId, metadataFor(bytes, overrides), bytes);
      expect(res.status).toBe(201);
      return ((await res.json()) as { development: DevelopmentBody }).development;
    }

    function patchDevelopment(photoId: string, developmentId: string, body: unknown) {
      return app.request(
        `/api/v1/photos/${photoId}/developments/${developmentId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
        env,
      );
    }

    function postPost(photoId: string, developmentId: string | null | undefined) {
      return app.request(
        `/api/v1/photos/${photoId}/posts`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            platform: "instagram",
            postUrl: "https://www.instagram.com/p/abc/",
            developmentId,
          }),
        },
        env,
      );
    }

    async function getDetail(photoId: string): Promise<DetailBody> {
      const res = await app.request(`/api/v1/photos/${photoId}`, {}, env);
      expect(res.status).toBe(200);
      return (await res.json()) as DetailBody;
    }

    function failR2Writes() {
      env.PHOTOS_BUCKET = {
        ...mockR2.bucket,
        put: async () => {
          throw new Error("R2 is unavailable");
        },
      } as unknown as R2Bucket;
    }

    /** A WebP signature is all the route reads of a file's contents. */
    function webpBytes(contents: string): Uint8Array {
      return new TextEncoder().encode(`RIFF\0\0\0\0WEBP${contents}`);
    }

    const FILE = webpBytes("developed-file-bytes");

    it("deletes the original photo, all associated assets, developments, and linked posts", async () => {
      const photoId = await createPhoto(1);
      const development = await uploadDevelopment(photoId, FILE);
      await postPost(photoId, development.id);
      await db
        .update(schema.photos)
        .set({ jpegKey: "original.jpg", thumbKey: "thumb.avif", rawKey: "raw/DSC00001.ARW" })
        .where(sql`id = ${photoId}`);
      for (const key of ["original.jpg", "thumb.avif", "raw/DSC00001.ARW"]) {
        mockR2.store.set(key, {
          body: new ArrayBuffer(0),
          contentType: "application/octet-stream",
        });
      }

      const res = await app.request(`/api/v1/photos/${photoId}`, { method: "DELETE" }, env);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(mockR2.store.size).toBe(0);
      expect(await db.select().from(schema.photos).all()).toHaveLength(0);
      expect(await db.select().from(schema.photoDevelopments).all()).toHaveLength(0);
      expect(await db.select().from(schema.photoPosts).all()).toHaveLength(0);
      expect((await app.request(`/api/v1/photos/${photoId}`, {}, env)).status).toBe(404);
    });

    it("stores an uploaded file and serves it back from the returned url", async () => {
      const photoId = await createPhoto(1);
      const development = await uploadDevelopment(photoId, FILE);
      expect(development.isFavorite).toBe(false);

      const asset = await app.request(development.url, {}, env);
      expect(asset.status).toBe(200);
      expect(asset.headers.get("content-type")).toBe("image/webp");
      expect(new Uint8Array(await asset.arrayBuffer())).toEqual(FILE);
    });

    it("sets and clears a version's favorite, updating favoriteDevelopmentsCount and favoriteDevelopedCount without touching the photo's favorite", async () => {
      const photoId = await createPhoto(1);
      const favorited = await uploadDevelopment(photoId, FILE);
      const other = await uploadDevelopment(photoId, webpBytes("another-file"));

      const res = await patchDevelopment(photoId, favorited.id, { isFavorite: true });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { development: DevelopmentBody };
      expect(body.development).toMatchObject({ id: favorited.id, photoId, isFavorite: true });

      const detail = await getDetail(photoId);
      expect(detail.isFavorite).toBe(false);
      expect(detail.developments.find((d) => d.id === favorited.id)?.isFavorite).toBe(true);
      expect(detail.developments.find((d) => d.id === other.id)?.isFavorite).toBe(false);

      const listRes = await app.request("/api/v1/photos?favorite=true", {}, env);
      const list = (await listRes.json()) as {
        photos: unknown[];
        facets: { favoriteCount: number; favoriteDevelopedCount: number };
      };
      expect(list.photos).toHaveLength(0);
      expect(list.facets.favoriteCount).toBe(0);
      expect(list.facets.favoriteDevelopedCount).toBe(1);

      const favDevListRes = await app.request(
        "/api/v1/photos?hasFavoriteDevelopment=true",
        {},
        env,
      );
      const favDevList = (await favDevListRes.json()) as {
        photos: Array<{ id: string; favoriteDevelopmentsCount: number }>;
        facets: { favoriteDevelopedCount: number };
      };
      expect(favDevList.photos).toHaveLength(1);
      expect(favDevList.photos[0]).toMatchObject({
        id: photoId,
        favoriteDevelopmentsCount: 1,
      });
      expect(favDevList.facets.favoriteDevelopedCount).toBe(1);

      const cleared = await patchDevelopment(photoId, favorited.id, { isFavorite: false });
      expect(cleared.status).toBe(200);
      const afterClear = await getDetail(photoId);
      expect(afterClear.developments.find((d) => d.id === favorited.id)?.isFavorite).toBe(false);

      const afterClearListRes = await app.request(
        "/api/v1/photos?hasFavoriteDevelopment=true",
        {},
        env,
      );
      const afterClearList = (await afterClearListRes.json()) as {
        photos: unknown[];
        facets: { favoriteDevelopedCount: number };
      };
      expect(afterClearList.photos).toHaveLength(0);
      expect(afterClearList.facets.favoriteDevelopedCount).toBe(0);
    });

    it("keeps version favorites when the photo's favorite changes", async () => {
      const photoId = await createPhoto(1);
      const development = await uploadDevelopment(photoId, FILE);
      await patchDevelopment(photoId, development.id, { isFavorite: true });

      for (const isFavorite of [true, false]) {
        const res = await app.request(
          `/api/v1/photos/${photoId}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ isFavorite }),
          },
          env,
        );
        expect(res.status).toBe(200);
        const detail = await getDetail(photoId);
        expect(detail.isFavorite).toBe(isFavorite);
        expect(detail.developments[0]?.isFavorite).toBe(true);
      }
    });

    it("rejects a favorite update for the wrong photo, the wrong user, or an invalid body", async () => {
      const photoId = await createPhoto(1);
      const otherPhotoId = await createPhoto(2);
      const development = await uploadDevelopment(photoId, FILE);
      const foreign = await createForeignDevelopment();

      const update = { isFavorite: true };
      expect((await patchDevelopment(otherPhotoId, development.id, update)).status).toBe(404);
      expect((await patchDevelopment(photoId, "no-such-version", update)).status).toBe(404);
      expect((await patchDevelopment(foreign.photoId, foreign.developmentId, update)).status).toBe(
        404,
      );
      expect((await patchDevelopment(photoId, foreign.developmentId, update)).status).toBe(404);
      expect((await patchDevelopment(photoId, development.id, { isFavorite: "yes" })).status).toBe(
        400,
      );

      expect((await getDetail(photoId)).developments[0]?.isFavorite).toBe(false);
      const foreignRow = await db.select().from(schema.photoDevelopments).all();
      expect(foreignRow.find((d) => d.id === foreign.developmentId)?.isFavorite).toBe(false);
    });

    it("keeps the favorite and posts when an existing file is uploaded again", async () => {
      const photoId = await createPhoto(1);
      const development = await uploadDevelopment(photoId, FILE);
      await patchDevelopment(photoId, development.id, { isFavorite: true });
      const postRes = await postPost(photoId, development.id);
      expect(postRes.status).toBe(201);

      const again = await uploadDevelopment(photoId, FILE, { label: "renamed" });
      expect(again).toMatchObject({ id: development.id, label: "renamed", isFavorite: true });

      const detail = await getDetail(photoId);
      expect(detail.developmentsCount).toBe(1);
      expect(detail.developments[0]).toMatchObject({ id: development.id, isFavorite: true });
      expect(detail.posts).toHaveLength(1);
      expect(detail.posts[0]?.developmentId).toBe(development.id);
    });

    it("accepts the same file as a version of two photos", async () => {
      const first = await createPhoto(1);
      const second = await createPhoto(2);

      const a = await uploadDevelopment(first, FILE);
      const b = await uploadDevelopment(second, FILE);

      expect(a.id).not.toBe(b.id);
      expect((await getDetail(first)).developments.map((d) => d.id)).toEqual([a.id]);
      expect((await getDetail(second)).developments.map((d) => d.id)).toEqual([b.id]);
    });

    it("records a post against a version of the same photo", async () => {
      const photoId = await createPhoto(1);
      const development = await uploadDevelopment(photoId, FILE);

      const res = await postPost(photoId, development.id);
      expect(res.status).toBe(201);
      const { post } = (await res.json()) as { post: PostBody };
      expect(post.developmentId).toBe(development.id);

      const detail = await getDetail(photoId);
      expect(detail.posts.map((p) => p.developmentId)).toEqual([development.id]);
    });

    it("still records a post on the original when developmentId is null or absent", async () => {
      const photoId = await createPhoto(1);

      expect((await postPost(photoId, null)).status).toBe(201);
      expect((await postPost(photoId, undefined)).status).toBe(201);

      const detail = await getDetail(photoId);
      expect(detail.posts.map((p) => p.developmentId)).toEqual([null, null]);
    });

    it("rejects a post on a version it does not own, without inserting", async () => {
      const photoId = await createPhoto(1);
      const otherPhotoId = await createPhoto(2);
      const otherPhotosVersion = await uploadDevelopment(otherPhotoId, FILE);
      const foreign = await createForeignDevelopment();

      for (const developmentId of [
        otherPhotosVersion.id,
        foreign.developmentId,
        "no-such-version",
        "",
      ]) {
        expect((await postPost(photoId, developmentId)).status).toBe(400);
      }
      expect((await postPost("no-such-photo", null)).status).toBe(404);

      expect((await getDetail(photoId)).posts).toHaveLength(0);
      expect(await db.select().from(schema.photoPosts).all()).toHaveLength(0);
    });

    it("rejects a file whose size or hash differs from the metadata", async () => {
      const photoId = await createPhoto(1);

      const wrongSize = await postUpload(
        photoId,
        metadataFor(FILE, { byteSize: FILE.byteLength + 1 }),
        FILE,
      );
      expect(wrongSize.status).toBe(400);

      const wrongHash = await postUpload(
        photoId,
        metadataFor(FILE, { sha256: "0".repeat(64) }),
        FILE,
      );
      expect(wrongHash.status).toBe(400);

      expect((await getDetail(photoId)).developments).toHaveLength(0);
      expect(mockR2.store.size).toBe(0);
    });

    it("rejects a file whose contents aren't the declared format", async () => {
      const photoId = await createPhoto(1);
      const notAnImage = new TextEncoder().encode("<html><script>alert(1)</script>");

      expect((await postUpload(photoId, metadataFor(notAnImage), notAnImage)).status).toBe(400);
      expect((await postUpload(photoId, metadataFor(FILE, { format: "png" }), FILE)).status).toBe(
        400,
      );

      expect((await getDetail(photoId)).developments).toHaveLength(0);
      expect(mockR2.store.size).toBe(0);
    });

    it("serves stored files with sniffing turned off", async () => {
      const photoId = await createPhoto(1);
      const development = await uploadDevelopment(photoId, FILE);

      const asset = await app.request(development.url, {}, env);

      expect(asset.headers.get("x-content-type-options")).toBe("nosniff");
    });

    it("leaves an existing row alone when only metadata is sent again", async () => {
      const photoId = await createPhoto(1);
      const development = await uploadDevelopment(photoId, FILE);

      const res = await app.request(
        `/api/v1/photos/${photoId}/developments`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(metadataFor(FILE, { format: "avif", byteSize: 999, width: 7 })),
        },
        env,
      );

      expect(res.status).toBe(201);
      expect(((await res.json()) as { development: DevelopmentBody }).development.id).toBe(
        development.id,
      );
      const stored = (await getDetail(photoId)).developments[0];
      expect(stored).toMatchObject({ format: "webp", byteSize: FILE.byteLength, width: 600 });
      expect((await app.request(development.url, {}, env)).status).toBe(200);
    });

    it("refuses a re-upload that would move a stored version to another format", async () => {
      const photoId = await createPhoto(1);
      const registered = await app.request(
        `/api/v1/photos/${photoId}/developments`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(metadataFor(FILE, { format: "png" })),
        },
        env,
      );
      expect(registered.status).toBe(201);

      const res = await postUpload(photoId, metadataFor(FILE), FILE);

      expect(res.status).toBe(400);
      expect((await getDetail(photoId)).developments[0]?.format).toBe("png");
      expect(mockR2.store.size).toBe(0);
    });

    it("describes the upload and favorite routes in the OpenAPI document", async () => {
      const res = await app.request("/api/openapi", {}, env);
      const { paths } = (await res.json()) as {
        paths: Record<
          string,
          Record<string, { requestBody?: unknown; responses: Record<string, unknown> }>
        >;
      };

      const upload = paths["/api/v1/photos/{id}/developments"]?.post;
      expect(Object.keys(upload?.responses ?? {})).toEqual(["201", "400", "404"]);
      expect(upload?.requestBody).toBeDefined();
      const favorite = paths["/api/v1/photos/{id}/developments/{devId}"]?.patch;
      expect(Object.keys(favorite?.responses ?? {})).toEqual(["200", "400", "404"]);
      expect(favorite?.requestBody).toBeDefined();
    });

    it("rejects a multipart upload with no file", async () => {
      const photoId = await createPhoto(1);

      const res = await postUpload(photoId, metadataFor(FILE));

      expect(res.status).toBe(400);
      expect((await getDetail(photoId)).developments).toHaveLength(0);
    });

    it("writes no row when storing a new file fails", async () => {
      const photoId = await createPhoto(1);
      failR2Writes();

      const res = await postUpload(photoId, metadataFor(FILE), FILE);

      expect(res.status).toBe(500);
      expect((await getDetail(photoId)).developments).toHaveLength(0);
    });

    it("leaves the existing row alone when storing a re-upload fails", async () => {
      const photoId = await createPhoto(1);
      await uploadDevelopment(photoId, FILE);
      failR2Writes();

      const res = await postUpload(photoId, metadataFor(FILE, { label: "renamed" }), FILE);

      expect(res.status).toBe(500);
      expect((await getDetail(photoId)).developments[0]?.label).toBe("edit");
    });

    function deleteDevelopment(photoId: string, developmentId: string) {
      return app.request(
        `/api/v1/photos/${photoId}/developments/${developmentId}`,
        { method: "DELETE" },
        env,
      );
    }

    it("deletes a version's row and file, and the photo stops counting as developed", async () => {
      const photoId = await createPhoto(1);
      const kept = await uploadDevelopment(photoId, webpBytes("kept"));
      const development = await uploadDevelopment(photoId, FILE);
      expect(mockR2.store.size).toBeGreaterThanOrEqual(2);
      const objectsBefore = mockR2.store.size;

      const res = await deleteDevelopment(photoId, development.id);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, deletedVersionLabel: "WEBP · edit" });

      expect(mockR2.store.size).toBe(objectsBefore - 1);
      expect((await app.request(development.url, {}, env)).status).toBe(404);
      const detail = await getDetail(photoId);
      expect(detail.developments.map((d) => d.id)).toEqual([kept.id]);
      expect(detail.developmentsCount).toBe(1);

      await deleteDevelopment(photoId, kept.id);
      const listRes = await app.request("/api/v1/photos?hasDeveloped=true", {}, env);
      const list = (await listRes.json()) as {
        photos: unknown[];
        facets: { developedCount: number };
      };
      expect(list.photos).toHaveLength(0);
      expect(list.facets.developedCount).toBe(0);
    });

    it("keeps a deleted version's posts, named, and doesn't call them posts of the original", async () => {
      const photoId = await createPhoto(1);
      const development = await uploadDevelopment(photoId, FILE);
      const other = await uploadDevelopment(photoId, webpBytes("other"), { label: "print" });
      await postPost(photoId, development.id);
      await postPost(photoId, other.id);
      await postPost(photoId, null);

      expect((await deleteDevelopment(photoId, development.id)).status).toBe(200);

      const { posts, postsCount } = await getDetail(photoId);
      expect(postsCount).toBe(3);
      const targets = posts.map((p) => [p.developmentId, p.deletedVersionLabel]);
      expect(targets).toContainEqual([null, "WEBP · edit"]);
      expect(targets).toContainEqual([other.id, null]);
      expect(targets).toContainEqual([null, null]);
    });

    it("rolls back the posts' new name when the row can't be deleted", async () => {
      const photoId = await createPhoto(1);
      const development = await uploadDevelopment(photoId, FILE);
      await postPost(photoId, development.id);
      const batch = db.batch.bind(db);
      db.batch = ((queries: Parameters<typeof batch>[0]) =>
        batch([...queries, db.run(sql`SELECT * FROM no_such_table`)] as never)) as typeof db.batch;

      expect((await deleteDevelopment(photoId, development.id)).status).toBe(500);

      db.batch = batch;
      const { posts, developments } = await getDetail(photoId);
      expect(developments).toHaveLength(1);
      expect(posts[0]).toMatchObject({ developmentId: development.id, deletedVersionLabel: null });
    });

    it("refuses to delete for the wrong photo or user, and deleting twice is a 404", async () => {
      const photoId = await createPhoto(1);
      const otherPhotoId = await createPhoto(2);
      const development = await uploadDevelopment(photoId, FILE);
      const foreign = await createForeignDevelopment();
      mockR2.store.set("foreign.webp", { body: new ArrayBuffer(1), contentType: "image/webp" });

      expect((await deleteDevelopment(otherPhotoId, development.id)).status).toBe(404);
      expect((await deleteDevelopment(photoId, foreign.developmentId)).status).toBe(404);
      expect((await deleteDevelopment(foreign.photoId, foreign.developmentId)).status).toBe(404);
      expect((await getDetail(photoId)).developments).toHaveLength(1);
      expect(mockR2.store.has("foreign.webp")).toBe(true);
      const rows = await db.select().from(schema.photoDevelopments).all();
      expect(rows.some((d) => d.id === foreign.developmentId)).toBe(true);

      expect((await deleteDevelopment(photoId, development.id)).status).toBe(200);
      expect((await deleteDevelopment(photoId, development.id)).status).toBe(404);
    });

    it("keeps the row and posts when removing the file fails, and a retry finishes", async () => {
      const photoId = await createPhoto(1);
      const development = await uploadDevelopment(photoId, FILE);
      await postPost(photoId, development.id);
      const bucket = env.PHOTOS_BUCKET;
      env.PHOTOS_BUCKET = {
        ...mockR2.bucket,
        delete: async () => {
          throw new Error("R2 is unavailable");
        },
      } as unknown as R2Bucket;

      expect((await deleteDevelopment(photoId, development.id)).status).toBe(500);
      const detail = await getDetail(photoId);
      expect(detail.developments).toHaveLength(1);
      expect(detail.posts[0]).toMatchObject({
        developmentId: development.id,
        deletedVersionLabel: null,
      });
      expect((await app.request(development.url, {}, env)).status).toBe(200);

      env.PHOTOS_BUCKET = bucket;
      expect((await deleteDevelopment(photoId, development.id)).status).toBe(200);
      expect((await getDetail(photoId)).developments).toHaveLength(0);
    });

    it("lets a deleted file be uploaded again as a new version", async () => {
      const photoId = await createPhoto(1);
      const development = await uploadDevelopment(photoId, FILE);
      await deleteDevelopment(photoId, development.id);

      const again = await uploadDevelopment(photoId, FILE);

      expect((await app.request(again.url, {}, env)).status).toBe(200);
      expect((await getDetail(photoId)).developmentsCount).toBe(1);
    });
  });

  it("resolves request origin for custom domain, branch preview, and commit preview URLs", () => {
    const prodReq = new Request("https://omoide.nikomaru.dev/api/auth/session", {
      headers: { host: "omoide.nikomaru.dev", "x-forwarded-proto": "https" },
    });
    expect(resolveRequestOrigin(prodReq)).toBe("https://omoide.nikomaru.dev");

    const branchPreviewReq = new Request(
      "https://main-omoide-web.nikomaru.workers.dev/api/auth/session",
      {
        headers: {
          host: "main-omoide-web.nikomaru.workers.dev",
          "x-forwarded-proto": "https",
        },
      },
    );
    expect(resolveRequestOrigin(branchPreviewReq)).toBe(
      "https://main-omoide-web.nikomaru.workers.dev",
    );

    const commitPreviewReq = new Request(
      "https://ea62a3d3-omoide-web.nikomaru.workers.dev/api/auth/session",
    );
    expect(resolveRequestOrigin(commitPreviewReq)).toBe(
      "https://ea62a3d3-omoide-web.nikomaru.workers.dev",
    );
  });
});
