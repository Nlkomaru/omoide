#!/usr/bin/env node
import path from "node:path";
import { parseArgs } from "node:util";
import { SocialPlatformSchema } from "@omoide/core";
import { loadCliConfig, OmoideApiClient, saveCliConfig } from "./client";
import { runWithConcurrency } from "./pool";
import {
  computeFileSha256,
  prepareBasePhotoUpload,
  prepareDevelopmentUpload,
  prepareRawUpload,
} from "./processor";
import { CliProgressBar } from "./progress";
import { executePhotoRename, scanDirectoriesForRename } from "./renamer";
import {
  buildStemFileIndex,
  DEFAULT_WINDOWS_PHOTO_DIRS,
  getDefaultSyncDirectories,
  scanDevelopedSessionDirectory,
  scanPhotoDirectories,
} from "./scanner";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? "help";
  const restArgs = args.slice(1);

  switch (command) {
    case "auth":
      await runAuthCommand(restArgs);
      break;
    case "sync":
      await runSyncCommand(restArgs);
      break;
    case "sync-developed":
      await runSyncDevelopedCommand(restArgs);
      break;
    case "sync-favorites":
      await runSyncFavoritesCommand(restArgs);
      break;
    case "rename":
      await runRenameCommand(restArgs);
      break;
    case "post":
      await runPostCommand(restArgs);
      break;
    default:
      printHelp();
      break;
  }
}

function printHelp() {
  console.log(`
Omoide CLI — Sony α7C (ILCE-7C) Photo Archive & RAW/Developed Sync Tool

Usage:
  omoide auth --url <server-url> --api-key <omod_...> [--dirs <dir1,dir2>] [--quality <80-100>] [--max-bytes <1048576>] [--concurrency <4>]
  omoide sync [paths...] [--with-raw] [--quality <1-100>] [--max-bytes <bytes>] [--concurrency <4>] [--dry-run]
  omoide sync-developed <session-dir> [--photo-dirs <dir1,dir2>] [--quality <1-100>] [--max-bytes <bytes>] [--concurrency <4>] [--dry-run]
  omoide sync-favorites [paths...] [--concurrency <4>] [--dry-run]
  omoide rename [paths...] [--dest <dir>] [--copy] [--dry-run]
  omoide post add --photo <uuidv7> --platform <instagram|twitter|blog|portfolio> --url <post-url> [--caption <text>]

Default Windows Sync Directories (overridable in config or --dirs):
  - ${DEFAULT_WINDOWS_PHOTO_DIRS.join("\n  - ")}
`);
}

async function runAuthCommand(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      url: { type: "string" },
      "api-key": { type: "string" },
      dirs: { type: "string" },
      quality: { type: "string" },
      "max-bytes": { type: "string" },
      concurrency: { type: "string" },
    },
  });

  const existing = await loadCliConfig();
  const nextUrl = values.url ?? existing.url ?? "http://localhost:3000";
  const nextKey = values["api-key"] ?? existing.apiKey ?? "";
  const nextDirs = values.dirs
    ? values.dirs
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean)
    : existing.photoDirs;
  const nextQuality = values.quality ? Number.parseInt(values.quality, 10) : existing.jpegQuality;
  const nextMaxBytes = values["max-bytes"]
    ? Number.parseInt(values["max-bytes"], 10)
    : existing.maxBytes;
  const nextConcurrency = values.concurrency
    ? Number.parseInt(values.concurrency, 10)
    : existing.concurrency;

  if (!nextKey) {
    console.error("Error: --api-key <omod_...> is required.");
    process.exit(1);
  }

  const savedPath = await saveCliConfig({
    url: nextUrl,
    apiKey: nextKey,
    photoDirs: nextDirs,
    jpegQuality: Number.isNaN(nextQuality) ? undefined : nextQuality,
    maxBytes: Number.isNaN(nextMaxBytes) ? undefined : nextMaxBytes,
    concurrency: Number.isNaN(nextConcurrency) ? undefined : nextConcurrency,
  });
  console.log(`Saved Omoide CLI credentials to ${savedPath}`);
  if (nextDirs && nextDirs.length > 0) {
    console.log(`Configured default photo directories: ${nextDirs.join(", ")}`);
  }
  if (typeof nextQuality === "number") {
    console.log(`Configured default JPEG quality: ${nextQuality}`);
  }
  if (typeof nextMaxBytes === "number") {
    console.log(`Configured default max JPEG size: ${Math.round(nextMaxBytes / 1024)}KB`);
  }
  if (typeof nextConcurrency === "number") {
    console.log(`Configured default concurrency: ${nextConcurrency}`);
  }
}

/**
 * `omoide sync [paths...] [--with-raw] [--dry-run]`
 * Scans directories for Sony α7C `.JPG` files, generates deterministic UUIDv7 + BlurHash + EXIF,
 * checks existing SHA-256 hashes, and uploads new photos (and `.ARW` RAW if `--with-raw`).
 */
async function runSyncCommand(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "with-raw": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      quality: { type: "string" },
      "max-bytes": { type: "string" },
      concurrency: { type: "string" },
    },
  });

  const config = await loadCliConfig();
  const targetDirs =
    positionals.length > 0 ? positionals : getDefaultSyncDirectories(config.photoDirs);

  if (targetDirs.length === 0) {
    console.error("No directories specified and no existing default photo drives found.");
    process.exit(1);
  }

  const rawConcurrency = values.concurrency
    ? Number.parseInt(values.concurrency, 10)
    : (config.concurrency ?? 4);
  // Cap concurrency to 16 to prevent socket connect timeouts on residential upload links
  const concurrency = Math.min(Math.max(1, rawConcurrency), 16);
  if (rawConcurrency > 16) {
    console.log(
      `ℹ️ Capping concurrency to ${concurrency} (requested: ${rawConcurrency}) to prevent socket exhaustion and timeouts.\n`,
    );
  }
  const quality = values.quality ? Number.parseInt(values.quality, 10) : config.jpegQuality;
  const maxBytes = values["max-bytes"]
    ? Number.parseInt(values["max-bytes"], 10)
    : (config.maxBytes ?? 1024 * 1024); // default ~1MB target if neither specified or maxBytes in config

  console.log(`Scanning directories:\n  - ${targetDirs.join("\n  - ")}`);
  const pairs = await scanPhotoDirectories(targetDirs);
  console.log(`Found ${pairs.length} Sony α7C JPEG photos.`);
  if (pairs.length === 0) return;

  const client = new OmoideApiClient(config);

  console.log("Computing SHA-256 hashes for deduplication...");
  const hashBar = new CliProgressBar({
    total: pairs.length,
    title: "Hashing",
  });

  const hashByPath = new Map<string, string>();
  await runWithConcurrency(pairs, 8, async (pair) => {
    const sha = await computeFileSha256(pair.jpegPath);
    hashByPath.set(pair.jpegPath, sha);
    hashBar.increment(1, pair.stem);
  });
  hashBar.complete(`Hashed ${pairs.length} photos.`);

  console.log("Checking existing photos on server...");
  const allHashes = Array.from(hashByPath.values());
  const existingStatuses = values["dry-run"] ? [] : await client.checkHashes(allHashes);
  const existingByHash = new Map(existingStatuses.map((item) => [item.jpegSha256, item]));

  let uploadedCount = 0;
  let skippedCount = 0;
  let rawUploadedCount = 0;
  let failedCount = 0;
  const failedItems: Array<{ stem: string; error: string }> = [];

  const syncBar = new CliProgressBar({
    total: pairs.length,
    title: values["dry-run"] ? "Dry-run" : "Syncing",
  });

  await runWithConcurrency(pairs, concurrency, async (pair) => {
    try {
      const sha = hashByPath.get(pair.jpegPath);
      if (!sha) {
        syncBar.increment(1, `${pair.stem} (skip)`);
        return;
      }
      const existing = existingByHash.get(sha);

      if (existing) {
        skippedCount++;
        // If --with-raw or photo is favorited on server and missing RAW, upload .ARW
        if (pair.rawPath && !existing.hasRaw && (values["with-raw"] || existing.isFavorite)) {
          if (values["dry-run"]) {
            syncBar.logAbove(`[DRY-RUN] Would attach RAW ${pair.rawPath} -> ${existing.photoId}`);
          } else {
            syncBar.logAbove(
              `Uploading 1:1 RAW ${path.basename(pair.rawPath)} -> ${existing.photoId}...`,
            );
            const rawMeta = await prepareRawUpload(pair.rawPath);
            await client.uploadRawFile(existing.photoId, rawMeta, pair.rawPath);
            rawUploadedCount++;
          }
        }
        syncBar.increment(1, `${pair.stem} (cached)`);
        return;
      }

      const prepared = await prepareBasePhotoUpload(pair.jpegPath, sha, quality, maxBytes);
      if (values["dry-run"]) {
        syncBar.logAbove(
          `[DRY-RUN] Would upload ${pair.stem} (${prepared.photoId}) — ${prepared.metadata.exif.lensModel ?? "ILCE-7C"}${
            prepared.compressedJpegBuffer
              ? ` [compressed ${Math.round(prepared.metadata.jpegByteSize / 1024)}KB]`
              : ""
          }`,
        );
        syncBar.increment(1, `${pair.stem} (dry-run)`);
        return;
      }

      syncBar.logAbove(
        `Uploading ${pair.stem} -> UUIDv7 ${prepared.photoId} (${prepared.metadata.exif.focalLengthMm ?? "?"}mm f/${prepared.metadata.exif.fNumber ?? "?"})${
          prepared.compressedJpegBuffer
            ? ` [compressed ${Math.round(prepared.metadata.jpegByteSize / 1024)}KB]`
            : ""
        }...`,
      );
      const { photoId } = await client.uploadBasePhoto(
        prepared.metadata,
        pair.jpegPath,
        prepared.thumbAvifBuffer,
        prepared.compressedJpegBuffer,
      );
      uploadedCount++;

      if (pair.rawPath && values["with-raw"]) {
        syncBar.logAbove(`  + Attaching 1:1 RAW ${path.basename(pair.rawPath)}...`);
        const rawMeta = await prepareRawUpload(pair.rawPath);
        await client.uploadRawFile(photoId, rawMeta, pair.rawPath);
        rawUploadedCount++;
      }

      syncBar.increment(1, `${pair.stem} (uploaded)`);
    } catch (err) {
      failedCount++;
      const msg = err instanceof Error ? err.message : String(err);
      failedItems.push({ stem: pair.stem, error: msg });
      syncBar.logAbove(`❌ Failed to upload ${pair.stem}: ${msg}`);
      syncBar.increment(1, `${pair.stem} (failed)`);
    }
  });

  syncBar.complete();

  console.log(
    `Sync complete: ${uploadedCount} JPEGs uploaded, ${rawUploadedCount} RAWs attached, ${skippedCount} already up to date, ${failedCount} failed.`,
  );
  if (failedItems.length > 0) {
    console.log(`\n⚠️  ${failedItems.length} photos failed to sync:`);
    for (const item of failedItems.slice(0, 10)) {
      console.log(`  - ${item.stem}: ${item.error}`);
    }
    if (failedItems.length > 10) {
      console.log(`  ... and ${failedItems.length - 10} more. Run sync again to retry.`);
    }
  }
}

/**
 * `omoide sync-developed <session-dir> [--photo-dirs <dir1,dir2>] [--dry-run]`
 * Scans a developed photo directory (e.g. `D:\Pictures\photos\2026-06-16_higashiyama`),
 * pairs `.ARW` files with `output/webp/*` and `output/png/*` exports, locates the 1:1 base `.JPG`
 * (in the session dir or in `--photo-dirs` / default drives), and uploads the base JPEG, 1:1 `.ARW` RAW,
 * and 1:N developed variants.
 */
async function runSyncDevelopedCommand(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "photo-dirs": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      quality: { type: "string" },
      "max-bytes": { type: "string" },
      concurrency: { type: "string" },
    },
  });

  const sessionDir = positionals[0];
  if (!sessionDir) {
    console.error("Error: Please provide <session-dir> to sync-developed.");
    process.exit(1);
  }

  const config = await loadCliConfig();
  const archiveDirs = values["photo-dirs"]
    ? values["photo-dirs"].split(",").map((d) => d.trim())
    : getDefaultSyncDirectories(config.photoDirs);

  const rawConcurrency = values.concurrency
    ? Number.parseInt(values.concurrency, 10)
    : (config.concurrency ?? 4);
  const concurrency = Math.min(Math.max(1, rawConcurrency), 16);
  if (rawConcurrency > 16) {
    console.log(
      `ℹ️ Capping concurrency to ${concurrency} (requested: ${rawConcurrency}) to prevent socket exhaustion and timeouts.\n`,
    );
  }
  const quality = values.quality ? Number.parseInt(values.quality, 10) : config.jpegQuality;
  const maxBytes = values["max-bytes"]
    ? Number.parseInt(values["max-bytes"], 10)
    : (config.maxBytes ?? 1024 * 1024);

  console.log(`Scanning developed session directory: ${sessionDir}`);
  const entries = await scanDevelopedSessionDirectory(sessionDir);
  console.log(
    `Found ${entries.length} base stems in session directory (${entries.reduce((acc, e) => acc + e.developments.length, 0)} developed variants).`,
  );
  if (entries.length === 0) return;

  const { jpegByStem, rawByStem } = await buildStemFileIndex(archiveDirs);
  const client = new OmoideApiClient(config);

  const devBar = new CliProgressBar({
    total: entries.length,
    title: values["dry-run"] ? "Dry-run dev" : "Syncing dev",
  });

  let failedDevCount = 0;

  await runWithConcurrency(entries, concurrency, async (entry) => {
    try {
      const jpegPath = entry.jpegPath ?? jpegByStem.get(entry.stem) ?? null;
      const rawPath = entry.rawPath ?? rawByStem.get(entry.stem) ?? null;

      if (!jpegPath) {
        devBar.logAbove(
          `Warning: Could not find base JPEG for ${entry.stem} in session dir or archive dirs. Skipping.`,
        );
        devBar.increment(1, `${entry.stem} (missing base)`);
        return;
      }

      const preparedBase = await prepareBasePhotoUpload(jpegPath, undefined, quality, maxBytes);
      if (values["dry-run"]) {
        devBar.logAbove(
          `[DRY-RUN] ${entry.stem} -> UUIDv7 ${preparedBase.photoId} | RAW: ${rawPath ? "yes" : "no"} | Developments: ${entry.developments.map((d) => `${d.format}:${d.label}`).join(", ")}`,
        );
        devBar.increment(1, `${entry.stem} (dry-run)`);
        return;
      }

      // Ensure base photo exists & mark as favorite since it was selected for development
      preparedBase.metadata.isFavorite = true;
      const { photoId } = await client.uploadBasePhoto(
        preparedBase.metadata,
        jpegPath,
        preparedBase.thumbAvifBuffer,
        preparedBase.compressedJpegBuffer,
      );
      devBar.logAbove(`Synced base photo ${entry.stem} (${photoId})`);

      if (rawPath) {
        devBar.logAbove(`  + Uploading 1:1 RAW ${path.basename(rawPath)}...`);
        const rawMeta = await prepareRawUpload(rawPath);
        await client.uploadRawFile(photoId, rawMeta, rawPath);
      }

      for (const dev of entry.developments) {
        devBar.logAbove(
          `  + Uploading 1:N developed variant [${dev.format.toUpperCase()}] ${dev.label}...`,
        );
        const devMeta = await prepareDevelopmentUpload(dev.filePath, dev.format, dev.label);
        await client.uploadDevelopmentVariant(photoId, devMeta, dev.filePath);
      }

      devBar.increment(1, `${entry.stem} (done)`);
    } catch (err) {
      failedDevCount++;
      const msg = err instanceof Error ? err.message : String(err);
      devBar.logAbove(`❌ Failed to sync developed entry ${entry.stem}: ${msg}`);
      devBar.increment(1, `${entry.stem} (failed)`);
    }
  });

  devBar.complete(
    failedDevCount > 0
      ? `Developed session sync finished with ${failedDevCount} failures.`
      : "Developed session sync complete.",
  );
}

/**
 * `omoide sync-favorites [paths...] [--dry-run]`
 * Queries the API for photos marked `isFavorite = true` that do not yet have `hasRaw = true`,
 * finds their matching `DSCxxxxx.ARW` in local directories, and uploads the 1:1 RAW files.
 */
async function runSyncFavoritesCommand(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      concurrency: { type: "string" },
    },
  });

  const config = await loadCliConfig();
  const searchDirs =
    positionals.length > 0 ? positionals : getDefaultSyncDirectories(config.photoDirs);
  if (searchDirs.length === 0) {
    console.error("Error: No local directories provided to locate .ARW files.");
    process.exit(1);
  }

  const concurrency = values.concurrency
    ? Number.parseInt(values.concurrency, 10)
    : (config.concurrency ?? 4);

  const client = new OmoideApiClient(config);

  const response = await client.listPhotos({
    favorite: "true",
    hasRaw: "false",
    limit: "200",
  });

  if (response.photos.length === 0) {
    console.log("All favorited photos already have 1:1 .ARW RAW files uploaded.");
    return;
  }

  console.log(
    `Found ${response.photos.length} favorited photos awaiting .ARW RAW upload. Indexing local directories...`,
  );
  const { rawByStem } = await buildStemFileIndex(searchDirs);

  const favBar = new CliProgressBar({
    total: response.photos.length,
    title: values["dry-run"] ? "Dry-run RAW" : "Uploading RAW",
  });

  await runWithConcurrency(response.photos, concurrency, async (photo) => {
    const stem = path.parse(photo.originalFilename).name.toUpperCase();
    const rawPath = rawByStem.get(stem);
    if (!rawPath) {
      favBar.logAbove(`  - Could not find ${stem}.ARW locally for ${photo.id}`);
      favBar.increment(1, `${stem} (not found)`);
      return;
    }

    if (values["dry-run"]) {
      favBar.logAbove(`[DRY-RUN] Would upload RAW ${path.basename(rawPath)} -> photo ${photo.id}`);
      favBar.increment(1, `${stem} (dry-run)`);
      return;
    }

    favBar.logAbove(`Uploading ${path.basename(rawPath)} for photo ${photo.id}...`);
    const rawMeta = await prepareRawUpload(rawPath);
    await client.uploadRawFile(photo.id, rawMeta, rawPath);
    favBar.increment(1, `${stem} (uploaded)`);
  });

  favBar.complete("Favorites RAW sync complete.");
}

/**
 * `omoide post add --photo <uuidv7> --platform <instagram|twitter|blog|portfolio> --url <url> [--caption <text>]`
 */
async function runPostCommand(argv: string[]) {
  const sub = argv[0];
  if (sub !== "add") {
    console.error("Usage: omoide post add --photo <id> --platform <platform> --url <url>");
    process.exit(1);
  }

  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      photo: { type: "string" },
      platform: { type: "string" },
      url: { type: "string" },
      caption: { type: "string" },
      development: { type: "string" },
    },
  });

  if (!values.photo || !values.platform || !values.url) {
    console.error("Error: --photo, --platform, and --url are required.");
    process.exit(1);
  }

  const platformParsed = SocialPlatformSchema.safeParse(values.platform);
  if (!platformParsed.success) {
    console.error("Error: --platform must be one of: instagram, twitter, blog, portfolio, other");
    process.exit(1);
  }

  const config = await loadCliConfig();
  const client = new OmoideApiClient(config);

  const post = await client.addSocialPost(values.photo, {
    platform: platformParsed.data,
    postUrl: values.url,
    caption: values.caption ?? null,
    developmentId: values.development ?? null,
  });

  console.log(
    `Registered ${post.platform} post (${post.id}) for photo ${post.photoId}: ${post.postUrl}`,
  );
}

/**
 * `omoide rename [paths...] [--dest <dir>] [--copy] [--dry-run]`
 *
 * Scans photo directories and reorganizes RAW/JPEG photos into `YYYY-MM-DD/<uuidv7>.<ext>`.
 * Files sharing the same stem (e.g. DSC02897.ARW and DSC02897.JPG) receive identical UUIDv7s.
 */
async function runRenameCommand(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      dest: { type: "string" },
      copy: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const config = await loadCliConfig();
  const targetDirs =
    positionals.length > 0 ? positionals : getDefaultSyncDirectories(config.photoDirs);

  if (targetDirs.length === 0) {
    console.error("Error: No photo directories found to scan for rename.");
    console.error(
      "Specify directories directly (e.g. `omoide rename F:\\DCIM`) or configure photoDirs.",
    );
    process.exit(1);
  }

  const isDryRun = Boolean(values["dry-run"]);
  const isCopy = Boolean(values.copy);
  const destDir = values.dest;

  console.log(`Scanning directories for photos to ${isCopy ? "copy" : "rename"}:`);
  for (const dir of targetDirs) {
    console.log(`  - ${dir}`);
  }
  if (destDir) {
    console.log(`Target destination: ${destDir}`);
  }
  if (isDryRun) {
    console.log("[DRY-RUN] Simulating rename operations without modifying files.\n");
  } else {
    console.log("");
  }

  const { groups, skippedAlreadyRenamed } = await scanDirectoriesForRename(targetDirs);

  if (skippedAlreadyRenamed > 0) {
    console.log(
      `Skipped ${skippedAlreadyRenamed} files already formatted as YYYY-MM-DD/<uuidv7>.<ext>.`,
    );
  }

  if (groups.length === 0) {
    console.log("No photos found that require renaming.");
    return;
  }

  let totalFilesToProcess = 0;
  for (const g of groups) {
    totalFilesToProcess += g.files.length;
  }
  console.log(
    `Found ${groups.length} photo groups (${totalFilesToProcess} total files) to process.\n`,
  );

  const summary = await executePhotoRename(groups, {
    dest: destDir,
    copy: isCopy,
    dryRun: isDryRun,
  });

  console.log(`\n=== Rename Summary ===`);
  console.log(`Total files scanned:   ${summary.totalScanned}`);
  console.log(`Total groups:          ${summary.totalGroups}`);
  console.log(`Successfully handled:  ${summary.processed}`);
  console.log(`Skipped:               ${summary.skipped}`);
  console.log(`Errors:                ${summary.errors}`);

  if (isDryRun) {
    console.log("\n[DRY-RUN] Preview of first 10 operations:");
    const sample = summary.items.slice(0, 10);
    for (const item of sample) {
      console.log(`  ${item.stem} -> ${item.destinationPath}`);
    }
    if (summary.items.length > 10) {
      console.log(`  ... and ${summary.items.length - 10} more files.`);
    }
    console.log("\nRe-run without --dry-run to apply these changes.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
