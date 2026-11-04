import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanDevelopedSessionDirectory, scanPhotoDirectories } from "./scanner";

describe("@omoide/cli directory & developed session scanner", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "omoide-cli-test-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("scans DCIM folders for 1:1 .JPG + .ARW pairs and ignores .rrdata files", async () => {
    const folder = path.join(tempRoot, "10761103");
    await mkdir(folder, { recursive: true });

    await writeFile(path.join(folder, "DSC03367.JPG"), "jpeg-data");
    await writeFile(path.join(folder, "DSC03367.ARW"), "arw-data");
    await writeFile(path.join(folder, "DSC03367.ARW.rrdata"), "ignored-sidecar");
    await writeFile(path.join(folder, "DSC03368.JPG"), "jpeg-only");

    const pairs = await scanPhotoDirectories([tempRoot]);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]?.stem).toBe("DSC03367");
    expect(pairs[0]?.rawPath).toBe(path.join(folder, "DSC03367.ARW"));
    expect(pairs[1]?.stem).toBe("DSC03368");
    expect(pairs[1]?.rawPath).toBeNull();
  });

  it("pairs developed output/webp/DSCxxxxx.00000000.webp and output/png/01.png with root .ARW files", async () => {
    const sessionDir = path.join(tempRoot, "2026-06-16_higashiyama");
    const webpDir = path.join(sessionDir, "output", "webp");
    const pngDir = path.join(sessionDir, "output", "png");
    await mkdir(webpDir, { recursive: true });
    await mkdir(pngDir, { recursive: true });

    await writeFile(path.join(sessionDir, "DSC01932.ARW"), "arw-1");
    await writeFile(path.join(sessionDir, "DSC01932.ARW.rrdata"), "sidecar-1");
    await writeFile(path.join(sessionDir, "DSC01944.ARW"), "arw-2");

    // Prefix-matched WebP exports
    await writeFile(path.join(webpDir, "DSC01932.00000000.webp"), "webp-1");
    await writeFile(path.join(webpDir, "DSC01944.00000000.webp"), "webp-2");

    // Sorted index-matched PNG exports (01.png -> 1st sorted ARW, 02.png -> 2nd sorted ARW)
    await writeFile(path.join(pngDir, "01.png"), "png-1");
    await writeFile(path.join(pngDir, "02.png"), "png-2");

    const scanned = await scanDevelopedSessionDirectory(sessionDir);
    expect(scanned).toHaveLength(2);

    expect(scanned[0]?.stem).toBe("DSC01932");
    expect(scanned[0]?.developments).toHaveLength(2);
    expect(scanned[0]?.developments.map((d) => d.format)).toEqual(["png", "webp"]);

    expect(scanned[1]?.stem).toBe("DSC01944");
    expect(scanned[1]?.developments).toHaveLength(2);
    expect(scanned[1]?.developments.map((d) => d.format)).toEqual(["png", "webp"]);
  });
});
