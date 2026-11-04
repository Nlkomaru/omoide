import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import path from "node:path";
import {
  type DevelopedFormat,
  encodeBlurhash,
  type NormalizedExifMetadata,
  normalizeExifMetadata,
  type RawExifInput,
  type UploadDevelopmentMetadata,
  type UploadPhotoMetadata,
  type UploadRawMetadata,
  uuidv7FromExifTimestamp,
} from "@omoide/core";
import exifr from "exifr";
import sharp from "sharp";

/**
 * Computes the lowercase hex SHA-256 of any file on disk using streaming.
 */
export async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Reads the first chunk (up to 256KB) of a file safely using a managed FileHandle,
 * ensuring the handle is always closed even on Node v26+ where unclosed handles error on GC.
 */
async function readFileHeaderBuffer(filePath: string, maxBytes = 256 * 1024): Promise<Buffer> {
  const fileStat = await stat(filePath);
  const bytesToRead = Math.min(fileStat.size, maxBytes);
  const buffer = Buffer.alloc(bytesToRead);

  const handle = await open(filePath, "r");
  try {
    if (bytesToRead > 0) {
      await handle.read(buffer, 0, bytesToRead, 0);
    }
    return buffer;
  } finally {
    await handle.close();
  }
}

/**
 * Extracts and normalizes Sony α7C EXIF metadata from a `.JPG` or `.ARW` file.
 */
export async function extractNormalizedExif(filePath: string): Promise<NormalizedExifMetadata> {
  const fileStat = await stat(filePath);
  let rawExif: RawExifInput = {};
  try {
    // Read the file header buffer explicitly and pass buffer to exifr.parse
    // to prevent exifr from leaving open FileHandle instances unclosed on Node 26+
    const headerBuffer = await readFileHeaderBuffer(filePath, 256 * 1024);
    const parsed = await exifr.parse(headerBuffer, {
      tiff: true,
      exif: true,
      gps: true,
    });
    if (parsed && typeof parsed === "object") {
      rawExif = parsed as RawExifInput;
    }
  } catch {
    // Fallback to file mtime if EXIF header cannot be parsed
  }

  return normalizeExifMetadata({
    ...rawExif,
    fallbackTimestampMs: Math.floor(fileStat.mtimeMs),
  });
}

/**
 * Computes image dimensions, 4x3 BlurHash, and an optional 640px AVIF thumbnail buffer using sharp.
 */
export async function processImageBufferWithSharp(filePath: string): Promise<{
  width: number;
  height: number;
  blurhash: string | null;
  thumbAvifBuffer: Buffer | null;
}> {
  const image = sharp(filePath).rotate();
  const metadata = await image.metadata();
  const width = metadata.width ?? 6000;
  const height = metadata.height ?? 4000;

  let blurhash: string | null = null;
  try {
    const { data, info } = await sharp(filePath)
      .rotate()
      .resize(32, 24, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    blurhash = encodeBlurhash(new Uint8ClampedArray(data), info.width, info.height);
  } catch {
    blurhash = null;
  }

  let thumbAvifBuffer: Buffer | null = null;
  try {
    thumbAvifBuffer = await sharp(filePath)
      .rotate()
      .resize({ width: 640, withoutEnlargement: true })
      .avif({ quality: 62 })
      .toBuffer();
  } catch {
    thumbAvifBuffer = null;
  }

  return {
    width,
    height,
    blurhash,
    thumbAvifBuffer,
  };
}

/**
 * Prepares full UploadPhotoMetadata + deterministic UUIDv7 for a base JPEG file.
 */
export async function prepareBasePhotoUpload(
  jpegPath: string,
  precomputedSha256?: string,
): Promise<{
  photoId: string;
  metadata: UploadPhotoMetadata;
  thumbAvifBuffer: Buffer | null;
}> {
  const [fileStat, jpegSha256, exif, processed] = await Promise.all([
    stat(jpegPath),
    precomputedSha256 ? Promise.resolve(precomputedSha256) : computeFileSha256(jpegPath),
    extractNormalizedExif(jpegPath),
    processImageBufferWithSharp(jpegPath),
  ]);

  const photoId = uuidv7FromExifTimestamp(exif.takenAt, jpegSha256);

  return {
    photoId,
    metadata: {
      originalFilename: path.basename(jpegPath),
      jpegSha256,
      jpegByteSize: fileStat.size,
      width: processed.width,
      height: processed.height,
      blurhash: processed.blurhash,
      isFavorite: false,
      description: null,
      exif,
    },
    thumbAvifBuffer: processed.thumbAvifBuffer,
  };
}

/**
 * Prepares UploadRawMetadata for a Sony .ARW file.
 */
export async function prepareRawUpload(rawPath: string): Promise<UploadRawMetadata> {
  const [fileStat, rawSha256] = await Promise.all([stat(rawPath), computeFileSha256(rawPath)]);

  return {
    rawSha256,
    rawByteSize: fileStat.size,
    originalFilename: path.basename(rawPath),
  };
}

/**
 * Prepares UploadDevelopmentMetadata for a developed variant file (`webp`, `png`, `jpeg`, `avif`).
 */
export async function prepareDevelopmentUpload(
  filePath: string,
  format: DevelopedFormat,
  label: string,
): Promise<UploadDevelopmentMetadata> {
  const [fileStat, sha256, processed] = await Promise.all([
    stat(filePath),
    computeFileSha256(filePath),
    processImageBufferWithSharp(filePath),
  ]);

  return {
    format,
    label,
    sha256,
    byteSize: fileStat.size,
    width: processed.width,
    height: processed.height,
    blurhash: processed.blurhash,
    developedAt: Math.floor(fileStat.mtimeMs),
  };
}
