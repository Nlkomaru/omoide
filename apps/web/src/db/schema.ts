import type { AuxiliaryExifData, DevelopedFormat, SocialPlatform } from "@omoide/core";
import { relations, sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// ============================================================
// Better Auth Core + @better-auth/api-key Tables
// ============================================================

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).default(false).notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const apikey = sqliteTable(
  "apikey",
  {
    id: text("id").primaryKey(),
    configId: text("config_id").default("default").notNull(),
    name: text("name"),
    start: text("start"),
    referenceId: text("reference_id").notNull(),
    prefix: text("prefix"),
    key: text("key").notNull(),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: integer("last_refill_at", { mode: "timestamp_ms" }),
    enabled: integer("enabled", { mode: "boolean" }).default(true),
    rateLimitEnabled: integer("rate_limit_enabled", {
      mode: "boolean",
    }).default(true),
    rateLimitTimeWindow: integer("rate_limit_time_window").default(86400000),
    rateLimitMax: integer("rate_limit_max").default(10),
    requestCount: integer("request_count").default(0),
    remaining: integer("remaining"),
    lastRequest: integer("last_request", { mode: "timestamp_ms" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (table) => [
    index("apikey_configId_idx").on(table.configId),
    index("apikey_referenceId_idx").on(table.referenceId),
    index("apikey_key_idx").on(table.key),
  ],
);

// ============================================================
// Omoide Domain Tables
// ============================================================

/**
 * 1:1 Base Photos Table (JPEG + optional paired Sony .ARW RAW)
 * Primary key `id` is a deterministic UUIDv7 generated from EXIF DateTimeOriginal + jpeg_sha256.
 */
export const photos = sqliteTable(
  "photos",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    originalFilename: text("original_filename").notNull(),
    takenAt: integer("taken_at").notNull(),
    timezoneOffset: text("timezone_offset").notNull().default("+09:00"),

    // Base JPEG (1:1)
    jpegKey: text("jpeg_key").notNull(),
    thumbKey: text("thumb_key"),
    jpegSha256: text("jpeg_sha256").notNull(),
    jpegByteSize: integer("jpeg_byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    blurhash: text("blurhash"),

    // Favorite & 1:1 RAW (.ARW)
    isFavorite: integer("is_favorite", { mode: "boolean" }).notNull().default(false),
    hasRaw: integer("has_raw", { mode: "boolean" }).notNull().default(false),
    rawKey: text("raw_key"),
    rawSha256: text("raw_sha256"),
    rawByteSize: integer("raw_byte_size"),

    // Core EXIF Columns (Hybrid Schema)
    cameraMake: text("camera_make").default("SONY"),
    cameraModel: text("camera_model").default("ILCE-7C"),
    lensModel: text("lens_model"),
    focalLengthMm: real("focal_length_mm"),
    fNumber: real("f_number"),
    exposureTime: text("exposure_time"),
    iso: integer("iso"),

    // Auxiliary EXIF JSON
    exifJson: text("exif_json", { mode: "json" }).$type<AuxiliaryExifData>(),

    description: text("description"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_photos_user_taken").on(table.userId, table.takenAt),
    uniqueIndex("idx_photos_user_sha256").on(table.userId, table.jpegSha256),
    index("idx_photos_user_lens").on(table.userId, table.lensModel),
    index("idx_photos_user_favorite").on(table.userId, table.isFavorite),
  ],
);

/**
 * 1:N Developed Variants Table (webp, png, jpeg, avif)
 */
export const photoDevelopments = sqliteTable(
  "photo_developments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    photoId: text("photo_id")
      .notNull()
      .references(() => photos.id, { onDelete: "cascade" }),
    format: text("format").$type<DevelopedFormat>().notNull(),
    label: text("label").notNull().default("default"),
    r2Key: text("r2_key").notNull(),
    sha256: text("sha256").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    blurhash: text("blurhash"),
    // Independent of photos.isFavorite, which also drives RAW sync.
    isFavorite: integer("is_favorite", { mode: "boolean" }).notNull().default(false),
    developedAt: integer("developed_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_photo_developments_photo_id").on(table.photoId),
    index("idx_photo_developments_user_id").on(table.userId),
    uniqueIndex("idx_photo_developments_sha256").on(table.photoId, table.sha256),
  ],
);

/**
 * 1:N Social & External Post Destinations (Instagram, Twitter/X, Blog, Portfolio)
 */
export const photoPosts = sqliteTable(
  "photo_posts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    photoId: text("photo_id")
      .notNull()
      .references(() => photos.id, { onDelete: "cascade" }),
    developmentId: text("development_id").references(() => photoDevelopments.id, {
      onDelete: "set null",
    }),
    deletedVersionLabel: text("deleted_version_label"),
    platform: text("platform").$type<SocialPlatform>().notNull(),
    postUrl: text("post_url").notNull(),
    externalPostId: text("external_post_id"),
    caption: text("caption"),
    postedAt: integer("posted_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_photo_posts_photo_id").on(table.photoId),
    index("idx_photo_posts_platform").on(table.userId, table.platform),
  ],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  photos: many(photos),
}));

export const photosRelations = relations(photos, ({ one, many }) => ({
  user: one(user, { fields: [photos.userId], references: [user.id] }),
  developments: many(photoDevelopments),
  posts: many(photoPosts),
}));

export const photoDevelopmentsRelations = relations(photoDevelopments, ({ one, many }) => ({
  photo: one(photos, {
    fields: [photoDevelopments.photoId],
    references: [photos.id],
  }),
  posts: many(photoPosts),
}));

export const photoPostsRelations = relations(photoPosts, ({ one }) => ({
  photo: one(photos, {
    fields: [photoPosts.photoId],
    references: [photos.id],
  }),
  development: one(photoDevelopments, {
    fields: [photoPosts.developmentId],
    references: [photoDevelopments.id],
  }),
}));
