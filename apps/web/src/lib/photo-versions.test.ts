import type { ApiPhotoDetail, PhotoDevelopmentItem, PhotoPostItem } from "@omoide/core";
import { describe, expect, it } from "vitest";
import {
  countPostsByDevelopment,
  downloadFilename,
  versionLabels,
  withDevelopment,
  withDevelopmentFavorite,
  withoutDevelopment,
  withPosts,
} from "./photo-versions";

function dev(id: string, developedAt: number, isFavorite = false): PhotoDevelopmentItem {
  return { id, developedAt, isFavorite } as PhotoDevelopmentItem;
}

function detail(developments: PhotoDevelopmentItem[]): ApiPhotoDetail {
  return {
    developments,
    developmentsCount: developments.length,
    favoriteDevelopmentsCount: developments.filter((d) => d.isFavorite).length,
  } as ApiPhotoDetail;
}

describe("versionLabels", () => {
  function named(id: string, developedAt: number, sha256 = id) {
    return { id, format: "webp", label: "edit", developedAt, sha256 } as PhotoDevelopmentItem;
  }

  const NOON = new Date(2026, 10, 5, 12, 0).getTime();
  const LATER_THAT_DAY = new Date(2026, 10, 5, 18, 30).getTime();
  const NEXT_DAY = new Date(2026, 10, 6, 12, 0).getTime();

  it("keeps a unique name short", () => {
    const other = { ...named("b", NOON), format: "png" } as PhotoDevelopmentItem;
    expect([...versionLabels([named("a", NOON), other]).values()]).toEqual([
      "WEBP · edit",
      "PNG · edit",
    ]);
  });

  it("adds the date to a shared name, and only to those sharing it", () => {
    const other = { ...named("c", NOON), label: "print" } as PhotoDevelopmentItem;
    const labels = versionLabels([named("a", NOON), named("b", NEXT_DAY), other]);

    expect(labels.get("a")).toBe("WEBP · edit · 2026-11-05");
    expect(labels.get("b")).toBe("WEBP · edit · 2026-11-06");
    expect(labels.get("c")).toBe("WEBP · print");
  });

  it("uses the time when the date is shared too, then the hash", () => {
    const sameDay = versionLabels([named("a", NOON), named("b", LATER_THAT_DAY)]);
    expect(sameDay.get("a")).toBe("WEBP · edit · 2026-11-05 12:00");
    expect(sameDay.get("b")).toBe("WEBP · edit · 2026-11-05 18:30");

    const sameMinute = versionLabels([named("a", NOON, "aaaaaaa1"), named("b", NOON, "bbbbbbb2")]);
    expect(sameMinute.get("a")).toBe("WEBP · edit · aaaaaaa");
    expect(sameMinute.get("b")).toBe("WEBP · edit · bbbbbbb");
  });
});

describe("withDevelopment", () => {
  it("inserts by developedAt and moves the count", () => {
    const next = withDevelopment(detail([dev("new", 30), dev("old", 10)]), dev("mid", 20));

    expect(next.developments.map((d) => d.id)).toEqual(["new", "mid", "old"]);
    expect(next.developmentsCount).toBe(3);
  });

  it("replaces a version with the same id", () => {
    const next = withDevelopment(detail([dev("a", 10)]), dev("a", 10, true));

    expect(next.developments).toEqual([dev("a", 10, true)]);
    expect(next.developmentsCount).toBe(1);
  });
});

describe("withDevelopmentFavorite", () => {
  it("changes only that version and updates favoriteDevelopmentsCount", () => {
    const next = withDevelopmentFavorite(detail([dev("a", 2), dev("b", 1)]), "b", true);

    expect(next.developments.map((d) => d.isFavorite)).toEqual([false, true]);
    expect(next.favoriteDevelopmentsCount).toBe(1);
  });
});

describe("withPosts", () => {
  it("derives the count and platforms", () => {
    const posts = [{ platform: "blog" }, { platform: "blog" }] as PhotoPostItem[];

    expect(withPosts(detail([]), posts)).toMatchObject({ postsCount: 2, platforms: ["blog"] });
  });
});

describe("countPostsByDevelopment", () => {
  it("counts per version and leaves out the original's posts", () => {
    const posts = [
      { developmentId: "a" },
      { developmentId: "a" },
      { developmentId: null },
    ] as PhotoPostItem[];

    expect(countPostsByDevelopment(posts)).toEqual(new Map([["a", 2]]));
  });
});

describe("downloadFilename", () => {
  it("keeps the original's name", () => {
    expect(downloadFilename("DSC1.JPG", undefined)).toBe("DSC1.JPG");
  });

  it("names a version after the photo, its label and its format", () => {
    expect(downloadFilename("DSC1.JPG", { format: "webp", label: "warm" })).toBe("DSC1-warm.webp");
    expect(downloadFilename("DSC1.JPG", { format: "jpeg", label: "warm" })).toBe("DSC1-warm.jpg");
  });

  it("makes a CLI label safe and doesn't repeat the stem", () => {
    expect(downloadFilename("DSC1.JPG", { format: "png", label: "a/b" })).toBe("DSC1-a-b.png");
    expect(downloadFilename("DSC1.JPG", { format: "png", label: "DSC1" })).toBe("DSC1.png");
  });
});

describe("withoutDevelopment", () => {
  it("drops the version and renames only its posts", () => {
    const post = (id: string, developmentId: string | null) =>
      ({ id, developmentId, deletedVersionLabel: null }) as PhotoPostItem;
    const before = {
      ...detail([dev("a", 2), dev("b", 1)]),
      posts: [post("of-a", "a"), post("of-b", "b"), post("of-original", null)],
    };

    const after = withoutDevelopment(before, "a", "WEBP · edit");

    expect(after.developments.map((d) => d.id)).toEqual(["b"]);
    expect(after.developmentsCount).toBe(1);
    expect(after.posts.map((p) => [p.id, p.developmentId, p.deletedVersionLabel])).toEqual([
      ["of-a", null, "WEBP · edit"],
      ["of-b", "b", null],
      ["of-original", null, null],
    ]);
  });
});
