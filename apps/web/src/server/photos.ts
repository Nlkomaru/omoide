import {
  type ApiPhotoDetail,
  type ApiPhotoSummary,
  type CheckedPhotoStatus,
  type CreatePhotoPostRequest,
  type ListPhotosQuery,
  type ListPhotosResponse,
  type PhotoDevelopmentItem,
  type PhotoPostItem,
  r2Keys,
  type SocialPlatform,
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

export async function addDevelopmentToPhotoRecord(
  db: AppDatabase,
  userId: string,
  photoId: string,
  metadata: UploadDevelopmentMetadata,
): Promise<{ r2Key: string; item: PhotoDevelopmentItem } | null> {
  const existingPhoto = await db
    .select({ id: photos.id })
    .from(photos)
    .where(and(eq(photos.id, photoId), eq(photos.userId, userId)))
    .limit(1);

  if (!existingPhoto[0]) return null;

  const existingDev = await db
    .select()
    .from(photoDevelopments)
    .where(
      and(eq(photoDevelopments.photoId, photoId), eq(photoDevelopments.sha256, metadata.sha256)),
    )
    .limit(1);

  const now = Date.now();
  const developedAt = metadata.developedAt ?? now;
  const devId = existingDev[0]?.id ?? uuidv7FromExifTimestamp(developedAt, metadata.sha256);
  const r2Key = r2Keys.development(userId, photoId, devId, metadata.format);

  if (existingDev[0]) {
    await db
      .update(photoDevelopments)
      .set({
        format: metadata.format,
        label: metadata.label,
        r2Key,
        byteSize: metadata.byteSize,
        width: metadata.width,
        height: metadata.height,
        blurhash: metadata.blurhash ?? existingDev[0].blurhash,
        developedAt,
      })
      .where(eq(photoDevelopments.id, devId));
  } else {
    await db.insert(photoDevelopments).values({
      id: devId,
      userId,
      photoId,
      format: metadata.format,
      label: metadata.label,
      r2Key,
      sha256: metadata.sha256,
      byteSize: metadata.byteSize,
      width: metadata.width,
      height: metadata.height,
      blurhash: metadata.blurhash,
      developedAt,
      createdAt: now,
    });
  }

  await db.update(photos).set({ updatedAt: now }).where(eq(photos.id, photoId));

  return {
    r2Key,
    item: {
      id: devId,
      photoId,
      format: metadata.format,
      label: metadata.label,
      url: buildDevelopmentAssetUrl(photoId, devId),
      sha256: metadata.sha256,
      byteSize: metadata.byteSize,
      width: metadata.width,
      height: metadata.height,
      blurhash: metadata.blurhash,
      developedAt,
      createdAt: existingDev[0]?.createdAt ?? now,
    },
  };
}

export async function addPostToPhotoRecord(
  db: AppDatabase,
  userId: string,
  photoId: string,
  input: CreatePhotoPostRequest,
): Promise<PhotoPostItem | null> {
  const existingPhoto = await db
    .select({ id: photos.id })
    .from(photos)
    .where(and(eq(photos.id, photoId), eq(photos.userId, userId)))
    .limit(1);

  if (!existingPhoto[0]) return null;

  const now = Date.now();
  const postedAt = input.postedAt ?? now;
  const postId = uuidv7(now);

  await db.insert(photoPosts).values({
    id: postId,
    userId,
    photoId,
    developmentId: input.developmentId ?? null,
    platform: input.platform,
    postUrl: input.postUrl,
    externalPostId: input.externalPostId ?? null,
    caption: input.caption ?? null,
    postedAt,
    createdAt: now,
  });

  await db.update(photos).set({ updatedAt: now }).where(eq(photos.id, photoId));

  return {
    id: postId,
    photoId,
    developmentId: input.developmentId ?? null,
    platform: input.platform,
    postUrl: input.postUrl,
    externalPostId: input.externalPostId ?? null,
    caption: input.caption ?? null,
    postedAt,
    createdAt: now,
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
    postsCount: posts.length,
    platforms,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    developments: developments.map((d) => ({
      id: d.id,
      photoId: d.photoId,
      format: d.format,
      label: d.label,
      url: buildDevelopmentAssetUrl(d.photoId, d.id),
      sha256: d.sha256,
      byteSize: d.byteSize,
      width: d.width,
      height: d.height,
      blurhash: d.blurhash,
      developedAt: d.developedAt,
      createdAt: d.createdAt,
    })),
    posts: posts.map((p) => ({
      id: p.id,
      photoId: p.photoId,
      developmentId: p.developmentId,
      platform: p.platform,
      postUrl: p.postUrl,
      externalPostId: p.externalPostId,
      caption: p.caption,
      postedAt: p.postedAt,
      createdAt: p.createdAt,
    })),
  };
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

  const photoIds = allUserPhotos.map((p) => p.id);
  const idChunks = chunkArray(photoIds, 60);

  const devRows: { photoId: string; id: string }[] = [];
  for (const chunk of idChunks) {
    const rows = await db
      .select({
        photoId: photoDevelopments.photoId,
        id: photoDevelopments.id,
      })
      .from(photoDevelopments)
      .where(inArray(photoDevelopments.photoId, chunk));
    devRows.push(...rows);
  }

  const postRows: { photoId: string; platform: SocialPlatform }[] = [];
  for (const chunk of idChunks) {
    const rows = await db
      .select({
        photoId: photoPosts.photoId,
        platform: photoPosts.platform,
      })
      .from(photoPosts)
      .where(inArray(photoPosts.photoId, chunk));
    postRows.push(...rows);
  }

  const devCountByPhoto = new Map<string, number>();
  for (const dev of devRows) {
    devCountByPhoto.set(dev.photoId, (devCountByPhoto.get(dev.photoId) ?? 0) + 1);
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
  let favoriteCount = 0;
  let developedCount = 0;
  let rawCount = 0;

  for (const p of allUserPhotos) {
    if (p.lensModel) {
      lensCounts.set(p.lensModel, (lensCounts.get(p.lensModel) ?? 0) + 1);
    }
    const monthStr = formatYearMonth(p.takenAt, p.timezoneOffset);
    monthCounts.set(monthStr, (monthCounts.get(monthStr) ?? 0) + 1);
    if (p.isFavorite) favoriteCount++;
    if (p.hasRaw) rawCount++;
    if ((devCountByPhoto.get(p.id) ?? 0) > 0) developedCount++;
  }

  // Apply query filters
  const filtered = allUserPhotos.filter((p) => {
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

    if (query.platform) {
      const platforms = platformsByPhoto.get(p.id);
      if (!platforms?.has(query.platform)) return false;
    }

    if (query.month) {
      const monthStr = formatYearMonth(p.takenAt, p.timezoneOffset);
      if (monthStr !== query.month) return false;
    }

    if (query.search) {
      const q = query.search.toLowerCase();
      const matchFilename = p.originalFilename.toLowerCase().includes(q);
      const matchLens = (p.lensModel ?? "").toLowerCase().includes(q);
      const matchDesc = (p.description ?? "").toLowerCase().includes(q);
      const matchId = p.id.toLowerCase().includes(q);
      if (!matchFilename && !matchLens && !matchDesc && !matchId) return false;
    }

    if (query.cursor) {
      const cursorTime = Number(query.cursor);
      if (Number.isFinite(cursorTime) && p.takenAt >= cursorTime) {
        return false;
      }
    }

    return true;
  });

  const limit = query.limit ?? 60;
  const page = filtered.slice(0, limit);
  const nextCursor =
    filtered.length > limit && page.length > 0 ? String(page[page.length - 1]?.takenAt) : null;

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
    postsCount: postCountByPhoto.get(row.id) ?? 0,
    platforms: Array.from(platformsByPhoto.get(row.id) ?? []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));

  return {
    photos: summaries,
    nextCursor,
    facets: {
      lenses: Array.from(lensCounts.entries())
        .map(([lensModel, count]) => ({ lensModel, count }))
        .sort((a, b) => b.count - a.count),
      months: Array.from(monthCounts.entries())
        .map(([month, count]) => ({ month, count }))
        .sort((a, b) => b.month.localeCompare(a.month)),
      totalCount: allUserPhotos.length,
      favoriteCount,
      developedCount,
      rawCount,
    },
  };
}

function formatYearMonth(takenAtMs: number, timezoneOffset: string): string {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(timezoneOffset);
  let offsetMinutes = 9 * 60;
  if (match) {
    const sign = match[1] === "-" ? -1 : 1;
    offsetMinutes = sign * (Number(match[2]) * 60 + Number(match[3]));
  }
  const localDate = new Date(takenAtMs + offsetMinutes * 60_000);
  const year = localDate.getUTCFullYear();
  const month = String(localDate.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
