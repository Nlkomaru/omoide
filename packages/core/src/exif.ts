import type { AuxiliaryExifData, NormalizedExifMetadata } from "./schemas";

export interface RawExifInput {
  DateTimeOriginal?: Date | string | number;
  CreateDate?: Date | string | number;
  ModifyDate?: Date | string | number;
  SubSecTimeOriginal?: string | number;
  OffsetTimeOriginal?: string;
  Make?: string;
  Model?: string;
  LensMake?: string;
  LensModel?: string;
  FocalLength?: number;
  FocalLengthIn35mmFormat?: number;
  FNumber?: number;
  ExposureTime?: number;
  ISO?: number;
  ExposureCompensation?: number;
  ExposureProgram?: string | number;
  WhiteBalance?: string | number;
  MeteringMode?: string | number;
  Flash?: string | number;
  GPSLatitude?: number;
  GPSLongitude?: number;
  GPSAltitude?: number;
  fallbackTimestampMs?: number;
}

/**
 * Formats an exposure time in seconds (e.g. 0.004) into a human-readable
 * camera shutter speed string (e.g. "1/250" or "2.5s").
 */
export function formatShutterSpeed(exposureTimeSec: number | undefined | null): string | null {
  if (
    exposureTimeSec === undefined ||
    exposureTimeSec === null ||
    Number.isNaN(exposureTimeSec) ||
    exposureTimeSec <= 0
  ) {
    return null;
  }
  if (exposureTimeSec >= 1) {
    const rounded = Math.round(exposureTimeSec * 10) / 10;
    return `${rounded}s`;
  }
  const denominator = Math.round(1 / exposureTimeSec);
  return `1/${denominator}`;
}

/**
 * Parses an EXIF date value (`Date`, `"2026:11:03 08:31:47"`, or ISO string)
 * plus optional `SubSecTimeOriginal` and `OffsetTimeOriginal` (defaults to `+09:00` JST)
 * into a Unix millisecond timestamp.
 */
export function parseExifTimestampMs(
  dateValue: Date | string | number | undefined,
  subSec?: string | number,
  offsetTime?: string,
  fallbackMs: number = Date.now(),
): { takenAt: number; timezoneOffset: string } {
  const tz =
    offsetTime && /^[+-]\d{2}:\d{2}$/.test(offsetTime.trim()) ? offsetTime.trim() : "+09:00";

  let baseMs: number | null = null;

  if (typeof dateValue === "number" && Number.isFinite(dateValue)) {
    baseMs = dateValue;
  } else if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) {
    baseMs = dateValue.getTime();
  } else if (typeof dateValue === "string") {
    const trimmed = dateValue.trim();
    // Match EXIF format: "YYYY:MM:DD HH:MM:SS" or "YYYY-MM-DD HH:MM:SS"
    const exifMatch = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/.exec(
      trimmed,
    );
    if (exifMatch) {
      const [, y, m, d, hh, mm, ss, inlineSubSec] = exifMatch;
      const isoString = `${y}-${m}-${d}T${hh}:${mm}:${ss}${tz}`;
      const parsed = Date.parse(isoString);
      if (!Number.isNaN(parsed)) {
        baseMs = parsed;
        if (inlineSubSec && subSec === undefined) {
          const msAdd = Number.parseInt(inlineSubSec.padEnd(3, "0").slice(0, 3), 10);
          if (!Number.isNaN(msAdd)) {
            baseMs += msAdd;
          }
        }
      }
    } else {
      const parsed = Date.parse(trimmed);
      if (!Number.isNaN(parsed)) {
        baseMs = parsed;
      }
    }
  }

  if (baseMs === null) {
    return { takenAt: Math.floor(fallbackMs), timezoneOffset: tz };
  }

  if (subSec !== undefined && subSec !== null) {
    const subSecStr = String(subSec).trim();
    if (/^\d+$/.test(subSecStr)) {
      const subMs = Number.parseInt(subSecStr.padEnd(3, "0").slice(0, 3), 10);
      if (!Number.isNaN(subMs)) {
        // Replace sub-second portion if baseMs was on whole second boundary
        baseMs = Math.floor(baseMs / 1000) * 1000 + subMs;
      }
    }
  }

  return { takenAt: Math.floor(baseMs), timezoneOffset: tz };
}

/**
 * Normalizes raw EXIF fields from Sony α7C (`ILCE-7C`) into:
 * - Core filterable columns (`cameraMake`, `cameraModel`, `lensModel`, `focalLengthMm`, `fNumber`, `exposureTime`, `iso`)
 * - Auxiliary JSON payload (`exifJson`)
 */
export function normalizeExifMetadata(input: RawExifInput): NormalizedExifMetadata {
  const rawDate = input.DateTimeOriginal ?? input.CreateDate ?? input.ModifyDate;
  const { takenAt, timezoneOffset } = parseExifTimestampMs(
    rawDate,
    input.SubSecTimeOriginal,
    input.OffsetTimeOriginal,
    input.fallbackTimestampMs,
  );

  const exposureTimeSec =
    typeof input.ExposureTime === "number" && Number.isFinite(input.ExposureTime)
      ? input.ExposureTime
      : null;

  const exifJson: AuxiliaryExifData = {
    lensMake: input.LensMake?.trim() || null,
    focalLength35mm:
      typeof input.FocalLengthIn35mmFormat === "number" &&
      Number.isFinite(input.FocalLengthIn35mmFormat)
        ? Math.round(input.FocalLengthIn35mmFormat)
        : null,
    exposureTimeSec,
    exposureCompensation:
      typeof input.ExposureCompensation === "number" && Number.isFinite(input.ExposureCompensation)
        ? Math.round(input.ExposureCompensation * 100) / 100
        : null,
    exposureProgram: input.ExposureProgram != null ? String(input.ExposureProgram) : null,
    whiteBalance: input.WhiteBalance != null ? String(input.WhiteBalance) : null,
    meteringMode: input.MeteringMode != null ? String(input.MeteringMode) : null,
    flash: input.Flash != null ? String(input.Flash) : null,
    gpsLat:
      typeof input.GPSLatitude === "number" && Number.isFinite(input.GPSLatitude)
        ? input.GPSLatitude
        : null,
    gpsLng:
      typeof input.GPSLongitude === "number" && Number.isFinite(input.GPSLongitude)
        ? input.GPSLongitude
        : null,
    gpsAltitude:
      typeof input.GPSAltitude === "number" && Number.isFinite(input.GPSAltitude)
        ? input.GPSAltitude
        : null,
  };

  return {
    takenAt,
    timezoneOffset,
    cameraMake: input.Make?.trim() || "SONY",
    cameraModel: input.Model?.trim() || "ILCE-7C",
    lensModel: input.LensModel?.trim() || null,
    focalLengthMm:
      typeof input.FocalLength === "number" && Number.isFinite(input.FocalLength)
        ? Math.round(input.FocalLength * 10) / 10
        : null,
    fNumber:
      typeof input.FNumber === "number" && Number.isFinite(input.FNumber)
        ? Math.round(input.FNumber * 10) / 10
        : null,
    exposureTime: formatShutterSpeed(exposureTimeSec),
    iso: typeof input.ISO === "number" && Number.isFinite(input.ISO) ? Math.round(input.ISO) : null,
    exifJson,
  };
}
