import { z } from "zod";

export const Sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Must be a 64-character lowercase hex SHA-256");

export const DevelopedFormatSchema = z.enum(["webp", "png", "jpeg", "avif"]);
export type DevelopedFormat = z.infer<typeof DevelopedFormatSchema>;

export const SocialPlatformSchema = z.enum(["instagram", "twitter", "blog", "portfolio", "other"]);
export type SocialPlatform = z.infer<typeof SocialPlatformSchema>;

export const AuxiliaryExifSchema = z.object({
  lensMake: z.string().nullable().default(null),
  focalLength35mm: z.number().int().nullable().default(null),
  exposureTimeSec: z.number().nullable().default(null),
  exposureCompensation: z.number().nullable().default(null),
  exposureProgram: z.string().nullable().default(null),
  whiteBalance: z.string().nullable().default(null),
  meteringMode: z.string().nullable().default(null),
  flash: z.string().nullable().default(null),
  gpsLat: z.number().nullable().default(null),
  gpsLng: z.number().nullable().default(null),
  gpsAltitude: z.number().nullable().default(null),
});
export type AuxiliaryExifData = z.infer<typeof AuxiliaryExifSchema>;

export const NormalizedExifMetadataSchema = z.object({
  takenAt: z.number().int(),
  timezoneOffset: z.string().default("+09:00"),
  cameraMake: z.string().default("SONY"),
  cameraModel: z.string().default("ILCE-7C"),
  lensModel: z.string().nullable().default(null),
  focalLengthMm: z.number().nullable().default(null),
  fNumber: z.number().nullable().default(null),
  exposureTime: z.string().nullable().default(null),
  iso: z.number().int().nullable().default(null),
  exifJson: AuxiliaryExifSchema,
});
export type NormalizedExifMetadata = z.infer<typeof NormalizedExifMetadataSchema>;

export const PhotoDevelopmentItemSchema = z.object({
  id: z.string(),
  photoId: z.string(),
  format: DevelopedFormatSchema,
  label: z.string(),
  url: z.string(),
  sha256: Sha256HexSchema,
  byteSize: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
  blurhash: z.string().nullable(),
  isFavorite: z.boolean(),
  developedAt: z.number().int(),
  createdAt: z.number().int(),
});
export type PhotoDevelopmentItem = z.infer<typeof PhotoDevelopmentItemSchema>;

export const PhotoPostItemSchema = z.object({
  id: z.string(),
  photoId: z.string(),
  developmentId: z.string().nullable(),
  /** The name of the version this post was of, once that version has been deleted. */
  deletedVersionLabel: z.string().nullable(),
  platform: SocialPlatformSchema,
  postUrl: z.string().url(),
  externalPostId: z.string().nullable(),
  caption: z.string().nullable(),
  postedAt: z.number().int(),
  createdAt: z.number().int(),
});
export type PhotoPostItem = z.infer<typeof PhotoPostItemSchema>;

export const ApiPhotoSummarySchema = z.object({
  id: z.string(),
  userId: z.string(),
  originalFilename: z.string(),
  takenAt: z.number().int(),
  timezoneOffset: z.string(),
  jpegUrl: z.string(),
  thumbUrl: z.string().nullable(),
  jpegSha256: Sha256HexSchema,
  jpegByteSize: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
  blurhash: z.string().nullable(),
  isFavorite: z.boolean(),
  hasRaw: z.boolean(),
  rawUrl: z.string().nullable(),
  rawByteSize: z.number().int().nullable(),
  cameraMake: z.string().nullable(),
  cameraModel: z.string().nullable(),
  lensModel: z.string().nullable(),
  focalLengthMm: z.number().nullable(),
  fNumber: z.number().nullable(),
  exposureTime: z.string().nullable(),
  iso: z.number().int().nullable(),
  exifJson: AuxiliaryExifSchema.nullable(),
  description: z.string().nullable(),
  developmentsCount: z.number().int(),
  postsCount: z.number().int(),
  platforms: z.array(SocialPlatformSchema),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type ApiPhotoSummary = z.infer<typeof ApiPhotoSummarySchema>;

export const ApiPhotoDetailSchema = ApiPhotoSummarySchema.extend({
  developments: z.array(PhotoDevelopmentItemSchema),
  posts: z.array(PhotoPostItemSchema),
});
export type ApiPhotoDetail = z.infer<typeof ApiPhotoDetailSchema>;

export const CheckPhotosRequestSchema = z.object({
  hashes: z.array(Sha256HexSchema).min(1).max(1000),
});
export type CheckPhotosRequest = z.infer<typeof CheckPhotosRequestSchema>;

export const CheckedPhotoStatusSchema = z.object({
  photoId: z.string(),
  jpegSha256: Sha256HexSchema,
  hasRaw: z.boolean(),
  isFavorite: z.boolean(),
  developmentHashes: z.array(Sha256HexSchema),
});
export type CheckedPhotoStatus = z.infer<typeof CheckedPhotoStatusSchema>;

export const CheckPhotosResponseSchema = z.object({
  items: z.array(CheckedPhotoStatusSchema),
});
export type CheckPhotosResponse = z.infer<typeof CheckPhotosResponseSchema>;

export const UploadPhotoMetadataSchema = z.object({
  originalFilename: z.string().min(1),
  jpegSha256: Sha256HexSchema,
  jpegByteSize: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  blurhash: z.string().nullable().default(null),
  isFavorite: z.boolean().default(false),
  description: z.string().nullable().default(null),
  exif: NormalizedExifMetadataSchema,
});
export type UploadPhotoMetadata = z.infer<typeof UploadPhotoMetadataSchema>;

export const UpdatePhotoRequestSchema = z.object({
  isFavorite: z.boolean().optional(),
  description: z.string().nullable().optional(),
});
export type UpdatePhotoRequest = z.infer<typeof UpdatePhotoRequestSchema>;

export const UploadRawMetadataSchema = z.object({
  rawSha256: Sha256HexSchema,
  rawByteSize: z.number().int().positive(),
  originalFilename: z.string().min(1),
});
export type UploadRawMetadata = z.infer<typeof UploadRawMetadataSchema>;

export const UploadDevelopmentMetadataSchema = z.object({
  format: DevelopedFormatSchema,
  label: z.string().min(1).default("default"),
  sha256: Sha256HexSchema,
  byteSize: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  blurhash: z.string().nullable().default(null),
  developedAt: z.number().int().optional(),
});
export type UploadDevelopmentMetadata = z.infer<typeof UploadDevelopmentMetadataSchema>;

export const UpdateDevelopmentRequestSchema = z.object({
  isFavorite: z.boolean().optional(),
});
export type UpdateDevelopmentRequest = z.infer<typeof UpdateDevelopmentRequestSchema>;

export const CreatePhotoPostRequestSchema = z.object({
  developmentId: z.string().nullable().optional(),
  platform: SocialPlatformSchema,
  postUrl: z.string().url(),
  externalPostId: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  postedAt: z.number().int().optional(),
});
export type CreatePhotoPostRequest = z.infer<typeof CreatePhotoPostRequestSchema>;

export const ListPhotosQuerySchema = z.object({
  lens: z.string().optional(),
  minFocal: z.coerce.number().optional(),
  maxFocal: z.coerce.number().optional(),
  favorite: z.enum(["true", "false"]).optional(),
  hasRaw: z.enum(["true", "false"]).optional(),
  hasDeveloped: z.enum(["true", "false"]).optional(),
  platform: SocialPlatformSchema.optional(),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(60),
  cursor: z.string().optional(),
});
export type ListPhotosQuery = z.infer<typeof ListPhotosQuerySchema>;

export const ListPhotosResponseSchema = z.object({
  photos: z.array(ApiPhotoSummarySchema),
  nextCursor: z.string().nullable(),
  /** Photos matching the filters, before the cursor and limit apply. */
  matchedCount: z.number().int(),
  facets: z.object({
    lenses: z.array(z.object({ lensModel: z.string(), count: z.number().int() })),
    months: z.array(z.object({ month: z.string(), count: z.number().int() })),
    totalCount: z.number().int(),
    favoriteCount: z.number().int(),
    developedCount: z.number().int(),
    rawCount: z.number().int(),
  }),
});
export type ListPhotosResponse = z.infer<typeof ListPhotosResponseSchema>;

/**
 * R2 object key builders
 */
export const r2Keys = {
  originalJpeg: (userId: string, photoId: string) =>
    `users/${userId}/photos/${photoId}/original.jpg`,
  thumbnail: (userId: string, photoId: string) => `users/${userId}/photos/${photoId}/thumb.avif`,
  rawArw: (userId: string, photoId: string, originalFilename: string) =>
    `users/${userId}/photos/${photoId}/raw/${originalFilename.replace(/\.[^.]+$/, "")}.ARW`,
  development: (userId: string, photoId: string, developmentId: string, format: DevelopedFormat) =>
    `users/${userId}/photos/${photoId}/developments/${developmentId}.${format}`,
};
