import { DatabaseSync } from "node:sqlite";
import { uuidv7FromExifTimestamp } from "@omoide/core";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "~/db/client";
import * as schema from "~/db/schema";
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
      developed_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE photo_posts (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      development_id TEXT REFERENCES photo_developments(id) ON DELETE SET NULL,
      platform TEXT NOT NULL,
      post_url TEXT NOT NULL,
      external_post_id TEXT,
      caption TEXT,
      posted_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  return drizzle(
    async (sql, params, method) => {
      const stmt = sqlite.prepare(sql);
      stmt.setReturnArrays(true);
      const boundParams = (params ?? []).map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p));
      if (method === "run") {
        stmt.run(...boundParams);
        return { rows: [] };
      }
      const rows = stmt.all(...boundParams) as unknown as unknown[][];
      if (method === "get") {
        return { rows: (rows[0] ?? []) as unknown[] };
      }
      return { rows };
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
});
