import type { DevelopedFormat } from "./schemas";

function hasBytes(bytes: Uint8Array, start: number, expected: readonly number[]): boolean {
  return expected.every((byte, i) => bytes[start + i] === byte);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

/** ISO BMFF files name their contents in the leading `ftyp` box, among other compatible brands. */
function isAvif(bytes: Uint8Array): boolean {
  if (bytes.length < 12 || ascii(bytes, 4, 4) !== "ftyp") return false;
  const boxSize = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0);
  const end = Math.min(boxSize, bytes.length);
  // The major brand, then the minor version, which isn't a brand, then the compatible brands.
  for (let at = 8; at + 4 <= end; at += at === 8 ? 8 : 4) {
    const brand = ascii(bytes, at, 4);
    if (brand === "avif" || brand === "avis") return true;
  }
  return false;
}

/** Reads a developed image's real format from its first bytes. Null for anything else. */
export function detectImageFormat(bytes: Uint8Array): DevelopedFormat | null {
  if (hasBytes(bytes, 0, [0xff, 0xd8, 0xff])) return "jpeg";
  if (hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
  return isAvif(bytes) ? "avif" : null;
}
