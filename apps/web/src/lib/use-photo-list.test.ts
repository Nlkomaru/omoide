import type { ApiPhotoSummary, ListPhotosResponse } from "@omoide/core";
import { describe, expect, it } from "vitest";
import { appendPage, mergeUpdatedPhoto } from "./use-photo-list";

function photo(id: string, isFavorite = false, favoriteDevelopmentsCount = 0): ApiPhotoSummary {
  return {
    id,
    isFavorite,
    hasRaw: false,
    developmentsCount: favoriteDevelopmentsCount,
    favoriteDevelopmentsCount,
  } as ApiPhotoSummary;
}

function response(photos: ApiPhotoSummary[], favoriteCount: number): ListPhotosResponse {
  return {
    photos,
    nextCursor: null,
    matchedCount: photos.length,
    facets: {
      lenses: [],
      months: [],
      totalCount: photos.length,
      favoriteCount,
      developedCount: 0,
      favoriteDevelopedCount: 0,
      rawCount: 0,
    },
  };
}

const NO_UPDATES = new Map<string, ApiPhotoSummary>();

describe("appendPage", () => {
  it("appends new rows once and takes the cursor and facets from the page", () => {
    const list = response([photo("a"), photo("b")], 1);
    const page = {
      ...response([photo("b"), photo("c"), photo("c")], 5),
      nextCursor: "next",
    };

    const merged = appendPage(list, page, NO_UPDATES);

    expect(merged.photos.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(merged.nextCursor).toBe("next");
    expect(merged.facets.favoriteCount).toBe(5);
  });

  it("keeps the loaded row over a duplicate from the page", () => {
    const list = response([photo("a", true)], 1);
    const merged = appendPage(list, response([photo("a", false)], 0), NO_UPDATES);
    expect(merged.photos[0]?.isFavorite).toBe(true);
  });

  it("keeps local favorite counts when an edit was saved while the page was in flight", () => {
    const list = mergeUpdatedPhoto(response([photo("a")], 3), photo("a", true));
    expect(list.facets.favoriteCount).toBe(4);

    const updates = new Map([["a", photo("a", true)]]);
    const merged = appendPage(list, response([photo("b")], 3), updates);

    expect(merged.facets.favoriteCount).toBe(4);
    expect(merged.photos.map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("mergeUpdatedPhoto", () => {
  it("updates a row from any loaded page and ignores unknown photos", () => {
    const list = appendPage(response([photo("a")], 0), response([photo("b")], 0), NO_UPDATES);

    const updated = mergeUpdatedPhoto(list, photo("b", true, 2));
    expect(updated.photos[1]?.isFavorite).toBe(true);
    expect(updated.photos[1]?.favoriteDevelopmentsCount).toBe(2);
    expect(updated.facets.favoriteCount).toBe(1);
    expect(updated.facets.favoriteDevelopedCount).toBe(1);

    expect(mergeUpdatedPhoto(list, photo("z", true))).toBe(list);
  });
});
