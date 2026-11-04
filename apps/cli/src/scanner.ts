import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { DevelopedFormat } from "@omoide/core";

export const DEFAULT_WINDOWS_PHOTO_DIRS = ["F:\\DCIM", "G:\\My Drive\\Photography\\picture"];

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "$RECYCLE.BIN",
  "System Volume Information",
  ".Spotlight-V100",
  ".Trashes",
]);

export interface ScannedPhotoPair {
  /** Base stem in uppercase, e.g. "DSC03367" */
  stem: string;
  /** Original JPEG file path */
  jpegPath: string;
  /** Optional 1:1 paired Sony .ARW file path */
  rawPath: string | null;
}

export interface DevelopedVariantFile {
  filePath: string;
  format: DevelopedFormat;
  label: string;
}

export interface ScannedDevelopedEntry {
  stem: string;
  rawPath: string | null;
  jpegPath: string | null;
  developments: DevelopedVariantFile[];
}

export function getDefaultSyncDirectories(): string[] {
  if (process.platform === "win32") {
    return DEFAULT_WINDOWS_PHOTO_DIRS.filter((d) => existsSync(d));
  }
  return [];
}

/**
 * Recursively scans one or more root directories for Sony α7C `.JPG` + `.ARW` 1:1 pairs.
 * Ignores `.rrdata` files and `output/` subdirectories.
 */
export async function scanPhotoDirectories(dirs: string[]): Promise<ScannedPhotoPair[]> {
  const results: ScannedPhotoPair[] = [];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    await walkForPairs(dir, results);
  }

  return results.sort((a, b) => a.jpegPath.localeCompare(b.jpegPath));
}

async function walkForPairs(currentDir: string, acc: ScannedPhotoPair[]): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });

  const jpegs = new Map<string, string>();
  const raws = new Map<string, string>();
  const subdirs: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name.toLowerCase().endsWith(".rrdata")) continue;

    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      if (entry.name.toLowerCase() === "output") continue;
      subdirs.push(fullPath);
      continue;
    }

    if (!entry.isFile()) continue;

    const parsed = path.parse(entry.name);
    const ext = parsed.ext.toLowerCase();
    const stem = parsed.name.toUpperCase();

    if (ext === ".jpg" || ext === ".jpeg") {
      jpegs.set(stem, fullPath);
    } else if (ext === ".arw") {
      raws.set(stem, fullPath);
    }
  }

  for (const [stem, jpegPath] of jpegs.entries()) {
    acc.push({
      stem,
      jpegPath,
      rawPath: raws.get(stem) ?? null,
    });
  }

  for (const sub of subdirs) {
    await walkForPairs(sub, acc);
  }
}

/**
 * Builds an index of all `.ARW` and `.JPG` files across local archive directories by stem (`DSCxxxxx`).
 * Used when a developed session folder only contains `.ARW` + `output/*` and needs the original `.JPG`,
 * or when `sync-favorites` needs to locate a `.ARW` file for a favorited photo.
 */
export async function buildStemFileIndex(dirs: string[]): Promise<{
  jpegByStem: Map<string, string>;
  rawByStem: Map<string, string>;
}> {
  const jpegByStem = new Map<string, string>();
  const rawByStem = new Map<string, string>();

  async function walk(dir: string) {
    if (!existsSync(dir)) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name.toLowerCase().endsWith(".rrdata")) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.toLowerCase() === "output") {
          continue;
        }
        await walk(fullPath);
      } else if (entry.isFile()) {
        const parsed = path.parse(entry.name);
        const ext = parsed.ext.toLowerCase();
        const stem = parsed.name.toUpperCase();
        if ((ext === ".jpg" || ext === ".jpeg") && !jpegByStem.has(stem)) {
          jpegByStem.set(stem, fullPath);
        } else if (ext === ".arw" && !rawByStem.has(stem)) {
          rawByStem.set(stem, fullPath);
        }
      }
    }
  }

  for (const dir of dirs) {
    await walk(dir);
  }

  return { jpegByStem, rawByStem };
}

/**
 * Scans a developed photo session directory (e.g. `D:\Pictures\photos\2026-06-16_higashiyama`).
 * Matches root `.ARW` / `.JPG` files with `output/webp/*`, `output/png/*`, `output/jpeg/*`, `output/avif/*`
 * by stem prefix (e.g. `DSC01932.00000000.webp` -> `DSC01932`) or by 1-based sorted index (`01.png` -> 1st `.ARW`).
 */
export async function scanDevelopedSessionDirectory(
  sessionDir: string,
): Promise<ScannedDevelopedEntry[]> {
  const rootEntries = await readdir(sessionDir, { withFileTypes: true });
  const entriesByStem = new Map<string, ScannedDevelopedEntry>();

  for (const entry of rootEntries) {
    if (!entry.isFile()) continue;
    if (entry.name.toLowerCase().endsWith(".rrdata")) continue;

    const parsed = path.parse(entry.name);
    const ext = parsed.ext.toLowerCase();
    const stem = parsed.name.toUpperCase();
    const fullPath = path.join(sessionDir, entry.name);

    if (ext === ".arw" || ext === ".jpg" || ext === ".jpeg") {
      const existing = entriesByStem.get(stem) ?? {
        stem,
        rawPath: null,
        jpegPath: null,
        developments: [],
      };
      if (ext === ".arw") existing.rawPath = fullPath;
      if (ext === ".jpg" || ext === ".jpeg") existing.jpegPath = fullPath;
      entriesByStem.set(stem, existing);
    }
  }

  const sortedStems = Array.from(entriesByStem.keys()).sort((a, b) => a.localeCompare(b));

  const outputDir = path.join(sessionDir, "output");
  if (existsSync(outputDir)) {
    const devFiles = await collectOutputFiles(outputDir);
    for (const devFile of devFiles) {
      const fileBase = path.basename(devFile.filePath);
      const parsed = path.parse(fileBase);
      const upperName = parsed.name.toUpperCase();

      // 1. Match by stem prefix (e.g. "DSC01932.00000000" starts with "DSC01932")
      let matchedStem = sortedStems.find(
        (stem) =>
          upperName === stem ||
          upperName.startsWith(`${stem}.`) ||
          upperName.startsWith(`${stem}_`) ||
          upperName.startsWith(`${stem}-`),
      );

      // 2. Match by 1-based numeric index (e.g. "01.png" -> sortedStems[0])
      if (!matchedStem && /^\d+$/.test(parsed.name)) {
        const index = Number.parseInt(parsed.name, 10) - 1;
        if (index >= 0 && index < sortedStems.length) {
          matchedStem = sortedStems[index];
        }
      }

      if (matchedStem) {
        const target = entriesByStem.get(matchedStem);
        if (target) {
          target.developments.push(devFile);
        }
      }
    }
  }

  return sortedStems
    .map((stem) => entriesByStem.get(stem))
    .filter((e): e is ScannedDevelopedEntry => Boolean(e));
}

async function collectOutputFiles(dir: string, subLabel = ""): Promise<DevelopedVariantFile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: DevelopedVariantFile[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name.toLowerCase().endsWith(".rrdata")) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectOutputFiles(fullPath, entry.name);
      results.push(...nested);
      continue;
    }

    if (!entry.isFile()) continue;
    const format = detectDevelopedFormat(entry.name);
    if (!format) continue;

    const parsed = path.parse(entry.name);
    const label = subLabel ? `${subLabel}/${parsed.name}` : parsed.name;
    results.push({
      filePath: fullPath,
      format,
      label,
    });
  }

  return results.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

export function detectDevelopedFormat(filename: string): DevelopedFormat | null {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".webp":
      return "webp";
    case ".png":
      return "png";
    case ".jpg":
    case ".jpeg":
      return "jpeg";
    case ".avif":
      return "avif";
    default:
      return null;
  }
}
