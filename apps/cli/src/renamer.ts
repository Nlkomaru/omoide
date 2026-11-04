import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { uuidv7 } from "@omoide/core";
import { extractNormalizedExif } from "./processor";
import { CliProgressBar } from "./progress";

export interface RenameOptions {
  /** Target root directory to place the YYYY-MM-DD/<uuidv7>.<ext> tree (defaults to source dir) */
  dest?: string;
  /** Copy files instead of renaming / moving */
  copy?: boolean;
  /** Dry run: do not rename or copy files, only simulate and log */
  dryRun?: boolean;
  /** Concurrency for processing EXIF and moving files */
  concurrency?: number;
}

export interface RenameResultItem {
  originalPath: string;
  destinationPath: string;
  dateStr: string;
  uuid: string;
  stem: string;
  status: "renamed" | "copied" | "skipped" | "error";
  error?: string;
}

export interface RenameSummary {
  totalScanned: number;
  totalGroups: number;
  processed: number;
  skipped: number;
  errors: number;
  items: RenameResultItem[];
}

const RAW_EXTS = new Set([".arw", ".cr2", ".cr3", ".nef", ".dng"]);
const JPEG_EXTS = new Set([".jpg", ".jpeg", ".hif", ".heif"]);
const SUPPORTED_EXTS = new Set([...RAW_EXTS, ...JPEG_EXTS]);

const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_DIR_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Checks if a file path is already organized as `.../YYYY-MM-DD/<uuidv7>.<ext>`.
 * Handles both Windows (`\`) and POSIX (`/`) separators.
 */
export function isAlreadyRenamedPath(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (segments.length < 2) return false;
  const fileName = segments[segments.length - 1];
  const dirName = segments[segments.length - 2];

  const parsed = path.posix.parse(fileName);
  return DATE_DIR_REGEX.test(dirName) && UUID_V7_REGEX.test(parsed.name);
}

/**
 * Converts timezone offset string (e.g. "+09:00", "-05:00", "Z") to minutes.
 */
export function parseTimezoneOffsetMinutes(offset: string | undefined): number {
  if (!offset || offset === "Z") {
    return 9 * 60; // Default to Japan Standard Time (+09:00) for Sony α7C
  }
  const match = /^([+-])(\d{1,2}):?(\d{2})?$/.exec(offset.trim());
  if (!match) return 9 * 60;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number.parseInt(match[2] ?? "0", 10);
  const minutes = Number.parseInt(match[3] ?? "0", 10);
  return sign * (hours * 60 + minutes);
}

/**
 * Formats a Unix timestamp (ms) and timezone offset into `YYYY-MM-DD`.
 */
export function formatLocalDateString(
  timestampMs: number,
  timezoneOffset: string = "+09:00",
): string {
  const offsetMinutes = parseTimezoneOffsetMinutes(timezoneOffset);
  const localDate = new Date(timestampMs + offsetMinutes * 60 * 1000);
  const year = localDate.getUTCFullYear();
  const month = String(localDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(localDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export interface ScannedFileForRename {
  filePath: string;
  stem: string;
  ext: string;
  isRaw: boolean;
  isJpeg: boolean;
}

export interface PhotoRenameGroup {
  stem: string;
  baseDir: string;
  files: ScannedFileForRename[];
}

/**
 * Recursively scans directories for RAW and JPEG photos, grouping files by stem (e.g. DSC02897).
 */
export async function scanDirectoriesForRename(
  roots: string[],
): Promise<{ groups: PhotoRenameGroup[]; skippedAlreadyRenamed: number }> {
  let skippedAlreadyRenamed = 0;
  const groupsMap = new Map<string, PhotoRenameGroup>();

  for (const root of roots) {
    if (!existsSync(root)) continue;
    await walkDir(root);
  }

  async function walkDir(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.toLowerCase() === "node_modules" || entry.name.startsWith("$")) {
          continue;
        }
        await walkDir(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      const parsed = path.parse(entry.name);
      const ext = parsed.ext.toLowerCase();

      if (!SUPPORTED_EXTS.has(ext)) continue;

      if (isAlreadyRenamedPath(fullPath)) {
        skippedAlreadyRenamed++;
        continue;
      }

      const stem = parsed.name.toUpperCase();
      // Group by directory + stem to avoid accidentally grouping files with identical names from different folders
      const groupKey = `${currentDir}:::${stem}`;

      let group = groupsMap.get(groupKey);
      if (!group) {
        group = {
          stem,
          baseDir: currentDir,
          files: [],
        };
        groupsMap.set(groupKey, group);
      }

      group.files.push({
        filePath: fullPath,
        stem,
        ext,
        isRaw: RAW_EXTS.has(ext),
        isJpeg: JPEG_EXTS.has(ext),
      });
    }
  }

  return {
    groups: Array.from(groupsMap.values()),
    skippedAlreadyRenamed,
  };
}

/**
 * Moves a file safely, falling back to copy+unlink if across filesystems (EXDEV).
 */
export async function safeMoveFile(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest);
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "EXDEV") {
      await copyFile(src, dest);
      await unlink(src);
    } else {
      throw err;
    }
  }
}

/**
 * Executes photo renaming/reorganization based on capture date and UUIDv7.
 */
export async function executePhotoRename(
  groups: PhotoRenameGroup[],
  options: RenameOptions = {},
): Promise<RenameSummary> {
  const isDryRun = Boolean(options.dryRun);
  const isCopy = Boolean(options.copy);
  const resultItems: RenameResultItem[] = [];

  let totalFiles = 0;
  for (const g of groups) {
    totalFiles += g.files.length;
  }

  const progress = new CliProgressBar({
    total: groups.length,
    title: isDryRun ? "Simulating Rename" : isCopy ? "Copying Photos" : "Renaming Photos",
  });

  let processedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const group of groups) {
    try {
      // 1. Determine capture timestamp & timezone from preferred file (JPEG preferred for fast EXIF)
      const primaryFile =
        group.files.find((f) => f.isJpeg) ?? group.files.find((f) => f.isRaw) ?? group.files[0];

      let takenAtMs = Date.now();
      let timezoneOffset = "+09:00";

      if (primaryFile) {
        try {
          const exif = await extractNormalizedExif(primaryFile.filePath);
          takenAtMs = exif.takenAt;
          timezoneOffset = exif.timezoneOffset;
        } catch {
          const fileStat = await stat(primaryFile.filePath);
          takenAtMs = Math.floor(fileStat.mtimeMs);
        }
      }

      const dateStr = formatLocalDateString(takenAtMs, timezoneOffset);
      // Generate a deterministic timestamp-based UUIDv7 for this shot pair
      const photoUuid = uuidv7(takenAtMs);

      for (const file of group.files) {
        // Base destination directory: explicitly supplied options.dest, or base directory of the photo
        const targetBaseDir = options.dest ? path.resolve(options.dest) : group.baseDir;
        const targetDir = path.join(targetBaseDir, dateStr);
        // Normalize extension to lowercase without leading dot (e.g. "arw", "jpg")
        const ext = file.ext.toLowerCase();
        const targetFilename = `${photoUuid}${ext}`;
        const targetPath = path.join(targetDir, targetFilename);

        if (targetPath === file.filePath) {
          resultItems.push({
            originalPath: file.filePath,
            destinationPath: targetPath,
            dateStr,
            uuid: photoUuid,
            stem: file.stem,
            status: "skipped",
          });
          skippedCount++;
          continue;
        }

        if (existsSync(targetPath)) {
          progress.logAbove(`⚠️ Destination already exists, skipping: ${targetPath}`);
          resultItems.push({
            originalPath: file.filePath,
            destinationPath: targetPath,
            dateStr,
            uuid: photoUuid,
            stem: file.stem,
            status: "skipped",
            error: "Destination already exists",
          });
          skippedCount++;
          continue;
        }

        if (isDryRun) {
          resultItems.push({
            originalPath: file.filePath,
            destinationPath: targetPath,
            dateStr,
            uuid: photoUuid,
            stem: file.stem,
            status: isCopy ? "copied" : "renamed",
          });
          processedCount++;
          continue;
        }

        // Execute directory creation and move/copy
        await mkdir(targetDir, { recursive: true });

        if (isCopy) {
          await copyFile(file.filePath, targetPath);
          resultItems.push({
            originalPath: file.filePath,
            destinationPath: targetPath,
            dateStr,
            uuid: photoUuid,
            stem: file.stem,
            status: "copied",
          });
        } else {
          await safeMoveFile(file.filePath, targetPath);
          resultItems.push({
            originalPath: file.filePath,
            destinationPath: targetPath,
            dateStr,
            uuid: photoUuid,
            stem: file.stem,
            status: "renamed",
          });
        }
        processedCount++;
      }
    } catch (err) {
      errorCount++;
      const msg = err instanceof Error ? err.message : String(err);
      progress.logAbove(`❌ Error processing group ${group.stem}: ${msg}`);
      for (const f of group.files) {
        resultItems.push({
          originalPath: f.filePath,
          destinationPath: "",
          dateStr: "",
          uuid: "",
          stem: group.stem,
          status: "error",
          error: msg,
        });
      }
    } finally {
      progress.increment(1, group.stem);
    }
  }

  return {
    totalScanned: totalFiles,
    totalGroups: groups.length,
    processed: processedCount,
    skipped: skippedCount,
    errors: errorCount,
    items: resultItems,
  };
}
