import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  executePhotoRename,
  formatLocalDateString,
  isAlreadyRenamedPath,
  parseTimezoneOffsetMinutes,
  scanDirectoriesForRename,
} from "./renamer";

describe("renamer utilities", () => {
  it("parses timezone offsets correctly", () => {
    expect(parseTimezoneOffsetMinutes("+09:00")).toBe(540);
    expect(parseTimezoneOffsetMinutes("-05:00")).toBe(-300);
    expect(parseTimezoneOffsetMinutes("Z")).toBe(540); // defaults to JST (+09:00)
    expect(parseTimezoneOffsetMinutes(undefined)).toBe(540);
  });

  it("formats local date strings based on timestamp and timezone offset", () => {
    // 2026-11-04 12:00:00 UTC = 2026-11-04 21:00:00 JST (+09:00)
    const utcTimestamp = Date.UTC(2026, 10, 4, 12, 0, 0);
    expect(formatLocalDateString(utcTimestamp, "+09:00")).toBe("2026-11-04");

    // 2026-11-04 20:00:00 UTC = 2026-11-05 05:00:00 JST (+09:00)
    const lateUtcTimestamp = Date.UTC(2026, 10, 4, 20, 0, 0);
    expect(formatLocalDateString(lateUtcTimestamp, "+09:00")).toBe("2026-11-05");
  });

  it("detects paths that are already formatted as YYYY-MM-DD/<uuidv7>.<ext>", () => {
    expect(
      isAlreadyRenamedPath("/photos/2026-11-04/01931a2b-3c4d-7e5f-8a1b-0123456789ab.arw"),
    ).toBe(true);
    expect(
      isAlreadyRenamedPath("F:\\2024-05-12\\018f4a12-8765-7123-9abc-def012345678.jpg"),
    ).toBe(true);
    expect(isAlreadyRenamedPath("F:\\DCIM\\10060905\\DSC02897.ARW")).toBe(false);
    expect(isAlreadyRenamedPath("/photos/DSC02897.JPG")).toBe(false);
  });
});

describe("executePhotoRename", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `omoide-rename-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("scans and groups paired RAW and JPEG files", async () => {
    const rawFile = path.join(tempDir, "DSC0001.ARW");
    const jpgFile = path.join(tempDir, "DSC0001.JPG");
    const soloRaw = path.join(tempDir, "DSC0002.ARW");

    await writeFile(rawFile, Buffer.from("dummy raw content"));
    await writeFile(jpgFile, Buffer.from("dummy jpeg content"));
    await writeFile(soloRaw, Buffer.from("dummy solo raw content"));

    const { groups, skippedAlreadyRenamed } = await scanDirectoriesForRename([tempDir]);
    expect(skippedAlreadyRenamed).toBe(0);
    expect(groups).toHaveLength(2);

    const pairGroup = groups.find((g) => g.stem === "DSC0001");
    expect(pairGroup).toBeDefined();
    expect(pairGroup?.files).toHaveLength(2);
    expect(pairGroup?.files.some((f) => f.isRaw)).toBe(true);
    expect(pairGroup?.files.some((f) => f.isJpeg)).toBe(true);

    const soloGroup = groups.find((g) => g.stem === "DSC0002");
    expect(soloGroup).toBeDefined();
    expect(soloGroup?.files).toHaveLength(1);
  });

  it("simulates rename with dry-run without altering files", async () => {
    const rawFile = path.join(tempDir, "DSC0100.ARW");
    const jpgFile = path.join(tempDir, "DSC0100.JPG");
    await writeFile(rawFile, Buffer.from("raw content"));
    await writeFile(jpgFile, Buffer.from("jpg content"));

    const { groups } = await scanDirectoriesForRename([tempDir]);
    const summary = await executePhotoRename(groups, {
      dest: path.join(tempDir, "dest"),
      dryRun: true,
    });

    expect(summary.totalScanned).toBe(2);
    expect(summary.processed).toBe(2);
    expect(summary.errors).toBe(0);

    // Files should still exist at original locations
    expect(existsSync(rawFile)).toBe(true);
    expect(existsSync(jpgFile)).toBe(true);
    // Destination folder should not be created
    expect(existsSync(path.join(tempDir, "dest"))).toBe(false);

    // Result items should share the same UUIDv7 and date folder
    const rawItem = summary.items.find((i) => i.originalPath === rawFile);
    const jpgItem = summary.items.find((i) => i.originalPath === jpgFile);
    expect(rawItem).toBeDefined();
    expect(jpgItem).toBeDefined();
    expect(rawItem?.uuid).toBe(jpgItem?.uuid);
    expect(rawItem?.destinationPath.endsWith(".arw")).toBe(true);
    expect(jpgItem?.destinationPath.endsWith(".jpg")).toBe(true);
  });

  it("renames and organizes files into YYYY-MM-DD/<uuidv7>.<ext>", async () => {
    const rawFile = path.join(tempDir, "DSC0200.ARW");
    const jpgFile = path.join(tempDir, "DSC0200.JPG");
    await writeFile(rawFile, Buffer.from("raw 200"));
    await writeFile(jpgFile, Buffer.from("jpg 200"));

    const destDir = path.join(tempDir, "dest");
    const { groups } = await scanDirectoriesForRename([tempDir]);

    const summary = await executePhotoRename(groups, {
      dest: destDir,
      dryRun: false,
    });

    expect(summary.processed).toBe(2);
    expect(summary.errors).toBe(0);

    // Original files should be moved
    expect(existsSync(rawFile)).toBe(false);
    expect(existsSync(jpgFile)).toBe(false);

    // New files should exist
    const rawItem = summary.items.find((i) => i.originalPath === rawFile)!;
    const jpgItem = summary.items.find((i) => i.originalPath === jpgFile)!;
    expect(existsSync(rawItem.destinationPath)).toBe(true);
    expect(existsSync(jpgItem.destinationPath)).toBe(true);

    // Verify format: .../dest/YYYY-MM-DD/<uuidv7>.ext
    expect(isAlreadyRenamedPath(rawItem.destinationPath)).toBe(true);
    expect(isAlreadyRenamedPath(jpgItem.destinationPath)).toBe(true);
  });

  it("copies files when copy option is true", async () => {
    const rawFile = path.join(tempDir, "DSC0300.ARW");
    await writeFile(rawFile, Buffer.from("raw 300"));

    const destDir = path.join(tempDir, "dest");
    const { groups } = await scanDirectoriesForRename([tempDir]);

    const summary = await executePhotoRename(groups, {
      dest: destDir,
      copy: true,
      dryRun: false,
    });

    expect(summary.processed).toBe(1);
    expect(existsSync(rawFile)).toBe(true); // Original preserved

    const item = summary.items[0];
    expect(existsSync(item.destinationPath)).toBe(true);
  });
});
