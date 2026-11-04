import { decode, encode, isBlurhashValid } from "blurhash";

export const BLURHASH_COMPONENTS_X = 4;
export const BLURHASH_COMPONENTS_Y = 3;

export function encodeBlurhash(rgba: Uint8ClampedArray, width: number, height: number): string {
  return encode(rgba, width, height, BLURHASH_COMPONENTS_X, BLURHASH_COMPONENTS_Y);
}

export function decodeBlurhashToRgba(
  hash: string,
  width: number,
  height: number,
): Uint8ClampedArray {
  return decode(hash, width, height);
}

export function isValidBlurhash(hash: string): boolean {
  return isBlurhashValid(hash).result;
}
