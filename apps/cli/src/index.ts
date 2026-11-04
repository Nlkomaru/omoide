#!/usr/bin/env node
import path from "node:path";
import { parseArgs } from "node:util";
import { SocialPlatformSchema } from "@omoide/core";
import { loadCliConfig, OmoideApiClient, saveCliConfig } from "./client";
import {
  computeFileSha256,
  prepareBasePhotoUpload,
  prepareDevelopmentUpload,
  prepareRawUpload,
} from "./processor";
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
  omoide auth --url <server-url> --api-key <omod_...> [--dirs <dir1,dir2>]
  omoide sync [paths...] [--with-raw] [--dry-run]
  omoide sync-developed <session-dir> [--photo-dirs <dir1,dir2>] [--dry-run]
  omoide sync-favorites [paths...] [--dry-run]
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

  if (!nextKey) {
    console.error("Error: --api-key <omod_...> is required.");
    process.exit(1);
  }

  const savedPath = await saveCliConfig({
    url: nextUrl,
    apiKey: nextKey,
    photoDirs: nextDirs,
  });
  console.log(`Saved Omoide CLI credentials to ${savedPath}`);
  if (nextDirs && nextDirs.length > 0) {
    console.log(`Configured default photo directories: ${nextDirs.join(", ")}`);
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
    },
  });

  const config = await loadCliConfig();
  const targetDirs =
    positionals.length > 0 ? positionals : getDefaultSyncDirectories(config.photoDirs);

  if (targetDirs.length === 0) {
    console.error("No directories specified and no existing default photo drives found.");
    process.exit(1);
  }

  console.log(`Scanning directories:\n  - ${targetDirs.join("\n  - ")}`);
  const pairs = await scanPhotoDirectories(targetDirs);
  console.log(`Found ${pairs.length} Sony α7C JPEG photos.`);
  if (pairs.length === 0) return;

  const client = new OmoideApiClient(config);

  console.log("Computing SHA-256 hashes for deduplication...");
  const hashByPath = new Map<string, string>();
  for (const pair of pairs) {
    const sha = await computeFileSha256(pair.jpegPath);
    hashByPath.set(pair.jpegPath, sha);
  }

  const allHashes = Array.from(hashByPath.values());
  const existingStatuses = values["dry-run"] ? [] : await client.checkHashes(allHashes);
  const existingByHash = new Map(existingStatuses.map((item) => [item.jpegSha256, item]));

  let uploadedCount = 0;
  let skippedCount = 0;
  let rawUploadedCount = 0;

  for (const pair of pairs) {
    const sha = hashByPath.get(pair.jpegPath);
    if (!sha) continue;
    const existing = existingByHash.get(sha);

    if (existing) {
      skippedCount++;
      // If --with-raw or photo is favorited on server and missing RAW, upload .ARW
      if (pair.rawPath && !existing.hasRaw && (values["with-raw"] || existing.isFavorite)) {
        if (values["dry-run"]) {
          console.log(`[DRY-RUN] Would attach RAW ${pair.rawPath} -> ${existing.photoId}`);
        } else {
          console.log(`Uploading 1:1 RAW ${path.basename(pair.rawPath)} -> ${existing.photoId}...`);
          const rawMeta = await prepareRawUpload(pair.rawPath);
          await client.uploadRawFile(existing.photoId, rawMeta, pair.rawPath);
          rawUploadedCount++;
        }
      }
      continue;
    }

    const prepared = await prepareBasePhotoUpload(pair.jpegPath, sha);
    if (values["dry-run"]) {
      console.log(
        `[DRY-RUN] Would upload ${pair.stem} (${prepared.photoId}) — ${prepared.metadata.exif.lensModel ?? "ILCE-7C"}`,
      );
      continue;
    }

    console.log(
      `Uploading ${pair.stem} -> UUIDv7 ${prepared.photoId} (${prepared.metadata.exif.focalLengthMm ?? "?"}mm f/${prepared.metadata.exif.fNumber ?? "?"})...`,
    );
    const { photoId } = await client.uploadBasePhoto(
      prepared.metadata,
      pair.jpegPath,
      prepared.thumbAvifBuffer,
    );
    uploadedCount++;

    if (pair.rawPath && values["with-raw"]) {
      console.log(`  + Attaching 1:1 RAW ${path.basename(pair.rawPath)}...`);
      const rawMeta = await prepareRawUpload(pair.rawPath);
      await client.uploadRawFile(photoId, rawMeta, pair.rawPath);
      rawUploadedCount++;
    }
  }

  console.log(
    `Sync complete: ${uploadedCount} JPEGs uploaded, ${rawUploadedCount} RAWs attached, ${skippedCount} already up to date.`,
  );
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

  console.log(`Scanning developed session directory: ${sessionDir}`);
  const entries = await scanDevelopedSessionDirectory(sessionDir);
  console.log(
    `Found ${entries.length} base stems in session directory (${entries.reduce((acc, e) => acc + e.developments.length, 0)} developed variants).`,
  );

  const { jpegByStem, rawByStem } = await buildStemFileIndex(archiveDirs);
  const client = new OmoideApiClient(config);

  for (const entry of entries) {
    const jpegPath = entry.jpegPath ?? jpegByStem.get(entry.stem) ?? null;
    const rawPath = entry.rawPath ?? rawByStem.get(entry.stem) ?? null;

    if (!jpegPath) {
      console.warn(
        `Warning: Could not find base JPEG for ${entry.stem} in session dir or archive dirs. Skipping.`,
      );
      continue;
    }

    const preparedBase = await prepareBasePhotoUpload(jpegPath);
    if (values["dry-run"]) {
      console.log(
        `[DRY-RUN] ${entry.stem} -> UUIDv7 ${preparedBase.photoId} | RAW: ${rawPath ? "yes" : "no"} | Developments: ${entry.developments.map((d) => `${d.format}:${d.label}`).join(", ")}`,
      );
      continue;
    }

    // Ensure base photo exists & mark as favorite since it was selected for development
    preparedBase.metadata.isFavorite = true;
    const { photoId } = await client.uploadBasePhoto(
      preparedBase.metadata,
      jpegPath,
      preparedBase.thumbAvifBuffer,
    );
    console.log(`Synced base photo ${entry.stem} (${photoId})`);

    if (rawPath) {
      console.log(`  + Uploading 1:1 RAW ${path.basename(rawPath)}...`);
      const rawMeta = await prepareRawUpload(rawPath);
      await client.uploadRawFile(photoId, rawMeta, rawPath);
    }

    for (const dev of entry.developments) {
      console.log(
        `  + Uploading 1:N developed variant [${dev.format.toUpperCase()}] ${dev.label}...`,
      );
      const devMeta = await prepareDevelopmentUpload(dev.filePath, dev.format, dev.label);
      await client.uploadDevelopmentVariant(photoId, devMeta, dev.filePath);
    }
  }

  console.log("Developed session sync complete.");
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
    },
  });

  const config = await loadCliConfig();
  const searchDirs =
    positionals.length > 0 ? positionals : getDefaultSyncDirectories(config.photoDirs);
  if (searchDirs.length === 0) {
    console.error("Error: No local directories provided to locate .ARW files.");
    process.exit(1);
  }

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

  for (const photo of response.photos) {
    const stem = path.parse(photo.originalFilename).name.toUpperCase();
    const rawPath = rawByStem.get(stem);
    if (!rawPath) {
      console.warn(`  - Could not find ${stem}.ARW locally for ${photo.id}`);
      continue;
    }

    if (values["dry-run"]) {
      console.log(`[DRY-RUN] Would upload ${rawPath} for favorite ${photo.id}`);
      continue;
    }

    console.log(`  + Uploading ${rawPath} for ${photo.originalFilename} (${photo.id})...`);
    const rawMeta = await prepareRawUpload(rawPath);
    await client.uploadRawFile(photo.id, rawMeta, rawPath);
  }

  console.log("Favorites RAW sync complete.");
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
