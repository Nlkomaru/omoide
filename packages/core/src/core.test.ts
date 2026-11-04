import { describe, expect, it } from "vitest";
import {
  BLURHASH_COMPONENTS_X,
  BLURHASH_COMPONENTS_Y,
  decodeBlurhashToRgba,
  detectImageFormat,
  encodeBlurhash,
  extractTimestampFromUuidv7,
  formatShutterSpeed,
  isValidBlurhash,
  normalizeExifMetadata,
  parseExifTimestampMs,
  r2Keys,
  uuidv7,
  uuidv7FromExifTimestamp,
} from "./index";

describe("@omoide/core UUIDv7 generation", () => {
  const sampleHashA = "a".repeat(64);
  const sampleHashB = "b".repeat(64);

  it("encodes exact EXIF capture timestamp into the first 48 bits of UUIDv7", () => {
    const takenAt = Date.parse("2026-11-03T08:31:47.125+09:00");
    const id = uuidv7FromExifTimestamp(takenAt, sampleHashA);

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(extractTimestampFromUuidv7(id)).toBe(takenAt);
  });

  it("is deterministic for the same timestamp and JPEG SHA-256, and distinct for burst shots", () => {
    const takenAt = Date.parse("2026-11-03T08:31:47.000+09:00");
    const id1 = uuidv7FromExifTimestamp(takenAt, sampleHashA);
    const id2 = uuidv7FromExifTimestamp(takenAt, sampleHashA);
    const idBurst = uuidv7FromExifTimestamp(takenAt, sampleHashB);

    expect(id1).toBe(id2);
    expect(id1).not.toBe(idBurst);
    expect(extractTimestampFromUuidv7(idBurst)).toBe(takenAt);
  });

  it("sorts chronologically by EXIF capture timestamp", () => {
    const earlier = uuidv7FromExifTimestamp(1700000000000, sampleHashB);
    const later = uuidv7FromExifTimestamp(1700000001000, sampleHashA);

    expect(earlier.localeCompare(later)).toBeLessThan(0);
  });

  it("generates standard random UUIDv7", () => {
    const now = 1730000000000;
    const id = uuidv7(now);
    expect(extractTimestampFromUuidv7(id)).toBe(now);
  });
});

describe("@omoide/core Sony a7C EXIF normalization", () => {
  it("parses Sony EXIF DateTimeOriginal with SubSecTimeOriginal and OffsetTimeOriginal", () => {
    const res = parseExifTimestampMs("2026:11:03 08:31:47", "42", "+09:00");
    expect(res.timezoneOffset).toBe("+09:00");
    expect(res.takenAt).toBe(Date.parse("2026-11-03T08:31:47.420+09:00"));
  });

  it("formats shutter speed strings accurately", () => {
    expect(formatShutterSpeed(0.004)).toBe("1/250");
    expect(formatShutterSpeed(1 / 4000)).toBe("1/4000");
    expect(formatShutterSpeed(2.5)).toBe("2.5s");
    expect(formatShutterSpeed(null)).toBeNull();
  });

  it("normalizes Sony ILCE-7C EXIF into core columns and auxiliary exifJson", () => {
    const normalized = normalizeExifMetadata({
      DateTimeOriginal: "2026:11:03 08:31:47",
      OffsetTimeOriginal: "+09:00",
      Make: "SONY",
      Model: "ILCE-7C",
      LensMake: "SIGMA",
      LensModel: "28-70mm F2.8 DG DN | Contemporary 021",
      FocalLength: 35.4,
      FocalLengthIn35mmFormat: 35,
      FNumber: 2.8,
      ExposureTime: 0.002,
      ISO: 160,
      ExposureCompensation: -0.3,
      WhiteBalance: "Auto",
    });

    expect(normalized.cameraMake).toBe("SONY");
    expect(normalized.cameraModel).toBe("ILCE-7C");
    expect(normalized.lensModel).toBe("28-70mm F2.8 DG DN | Contemporary 021");
    expect(normalized.focalLengthMm).toBe(35.4);
    expect(normalized.fNumber).toBe(2.8);
    expect(normalized.exposureTime).toBe("1/500");
    expect(normalized.iso).toBe(160);
    expect(normalized.exifJson.lensMake).toBe("SIGMA");
    expect(normalized.exifJson.focalLength35mm).toBe(35);
    expect(normalized.exifJson.exposureCompensation).toBe(-0.3);
  });
});

describe("@omoide/core BlurHash & R2 key helpers", () => {
  it("encodes and validates a BlurHash from RGBA buffer", () => {
    const width = 4;
    const height = 3;
    const rgba = new Uint8ClampedArray(width * height * 4).fill(180);
    const hash = encodeBlurhash(rgba, width, height);

    expect(BLURHASH_COMPONENTS_X).toBe(4);
    expect(BLURHASH_COMPONENTS_Y).toBe(3);
    expect(isValidBlurhash(hash)).toBe(true);
    expect(decodeBlurhashToRgba(hash, 8, 6)).toHaveLength(8 * 6 * 4);
  });

  it("constructs canonical R2 keys", () => {
    expect(r2Keys.originalJpeg("u1", "p1")).toBe("users/u1/photos/p1/original.jpg");
    expect(r2Keys.rawArw("u1", "p1", "DSC03367.JPG")).toBe("users/u1/photos/p1/raw/DSC03367.ARW");
    expect(r2Keys.development("u1", "p1", "d1", "webp")).toBe(
      "users/u1/photos/p1/developments/d1.webp",
    );
  });
});

describe("@omoide/core image format detection", () => {
  const bytes = (...parts: (string | number[])[]) =>
    new Uint8Array(
      parts.flatMap((part) =>
        typeof part === "string" ? Array.from(part, (c) => c.charCodeAt(0)) : part,
      ),
    );

  it("recognizes each developed format from its first bytes", () => {
    expect(detectImageFormat(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(detectImageFormat(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(detectImageFormat(bytes("RIFF", [1, 2, 3, 4], "WEBPVP8 "))).toBe("webp");
    expect(detectImageFormat(bytes([0, 0, 0, 16], "ftypavif", [0, 0, 0, 0]))).toBe("avif");
    expect(detectImageFormat(bytes([0, 0, 0, 20], "ftypavis", [0, 0, 0, 0], "msf1"))).toBe("avif");
  });

  it("finds AVIF among the compatible brands, within the ftyp box", () => {
    expect(detectImageFormat(bytes([0, 0, 0, 24], "ftypmif1", [0, 0, 0, 0], "miafavif"))).toBe(
      "avif",
    );
    expect(
      detectImageFormat(bytes([0, 0, 0, 20], "ftypmif1", [0, 0, 0, 0], "miafavif")),
    ).toBeNull();
  });

  it("doesn't read the minor version as a brand", () => {
    expect(detectImageFormat(bytes([0, 0, 0, 16], "ftypmif1avif"))).toBeNull();
  });

  it("refuses everything else", () => {
    expect(
      detectImageFormat(bytes([0, 0, 0, 24], "ftypheic", [0, 0, 0, 0], "mif1heic")),
    ).toBeNull();
    expect(detectImageFormat(bytes("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(detectImageFormat(bytes("GIF89a"))).toBeNull();
    expect(detectImageFormat(bytes("RIFF", [1, 2, 3, 4], "WAVEfmt "))).toBeNull();
    expect(detectImageFormat(new Uint8Array())).toBeNull();
  });
});
