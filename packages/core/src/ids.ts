const HEX = "0123456789abcdef";

function formatUuidBytes(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += HEX[byte >> 4] + HEX[byte & 0x0f];
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function writeTimestamp48(bytes: Uint8Array, timestampMs: number): void {
  const safeMs = Math.max(0, Math.floor(timestampMs));
  bytes[0] = Math.floor(safeMs / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(safeMs / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(safeMs / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(safeMs / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(safeMs / 2 ** 8) & 0xff;
  bytes[5] = safeMs & 0xff;
}

/**
 * Generates a standard random-seeded UUIDv7 from `timestampMs` (defaults to `Date.now()`).
 */
export function uuidv7(timestampMs: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  writeTimestamp48(bytes, timestampMs);

  // Version 7 (0111xxxx) and RFC 4122 Variant (10xxxxxx)
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return formatUuidBytes(bytes);
}

/**
 * Generates a deterministic UUIDv7 for an original photo using its EXIF capture
 * timestamp (`takenAtMs`) as the 48-bit prefix and its SHA-256 hex digest (`sha256Hex`)
 * as the 74-bit payload.
 *
 * This ensures:
 * 1. Primary keys sort chronologically by EXIF capture time.
 * 2. Burst shots taken within the same millisecond get distinct IDs.
 * 3. Computing the ID on the CLI or the Server always yields the exact same UUIDv7.
 */
export function uuidv7FromExifTimestamp(takenAtMs: number, sha256Hex: string): string {
  const normalizedHex = sha256Hex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalizedHex)) {
    throw new Error("sha256Hex must be a 64-character hexadecimal string");
  }

  const bytes = new Uint8Array(16);
  writeTimestamp48(bytes, takenAtMs);

  // Fill bytes 6..15 deterministically from the first 10 bytes of the SHA-256 digest
  for (let i = 0; i < 10; i++) {
    bytes[6 + i] = Number.parseInt(normalizedHex.slice(i * 2, i * 2 + 2), 16);
  }

  // Version 7 (0111xxxx) and RFC 4122 Variant (10xxxxxx)
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return formatUuidBytes(bytes);
}

/**
 * Extracts the 48-bit Unix millisecond timestamp encoded in a UUIDv7 string.
 */
export function extractTimestampFromUuidv7(uuid: string): number {
  const clean = uuid.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/i.test(clean)) {
    throw new Error(`Invalid UUID: ${uuid}`);
  }
  return Number.parseInt(clean.slice(0, 12), 16);
}
