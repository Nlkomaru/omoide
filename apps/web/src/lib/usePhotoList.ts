import type { ApiPhotoSummary, ListPhotosResponse } from "@omoide/core";
import { useCallback, useEffect, useRef, useState } from "react";

export type LoadError = "unauthorized" | "failed";

type LocalUpdates = ReadonlyMap<string, ApiPhotoSummary>;

/** Replaces a row and moves the facet counts by what actually changed on it. */
export function mergeUpdatedPhoto(
  list: ListPhotosResponse,
  updated: ApiPhotoSummary,
): ListPhotosResponse {
  const previous = list.photos.find((p) => p.id === updated.id);
  if (!previous) return list;
  return {
    ...list,
    photos: list.photos.map((p) => (p.id === updated.id ? updated : p)),
    facets: {
      ...list.facets,
      favoriteCount:
        list.facets.favoriteCount + Number(updated.isFavorite) - Number(previous.isFavorite),
      rawCount: list.facets.rawCount + Number(updated.hasRaw) - Number(previous.hasRaw),
      developedCount:
        list.facets.developedCount +
        Number(updated.developmentsCount > 0) -
        Number(previous.developmentsCount > 0),
    },
  };
}

/**
 * Takes the newest response's cursor and facets. An edit saved while the request was in flight may
 * or may not be in that response, so its row and the counts it moves stay as they are locally.
 */
function withLocalUpdates(
  page: ListPhotosResponse,
  previous: ListPhotosResponse | null,
  updates: LocalUpdates,
): ListPhotosResponse {
  if (updates.size === 0 || !previous) return page;
  return {
    ...page,
    photos: page.photos.map((p) => updates.get(p.id) ?? p),
    facets: {
      ...page.facets,
      favoriteCount: previous.facets.favoriteCount,
      rawCount: previous.facets.rawCount,
      developedCount: previous.facets.developedCount,
    },
  };
}

/** Appends a page, keeping the loaded row when the library shifted and a photo comes back. */
export function appendPage(
  list: ListPhotosResponse,
  page: ListPhotosResponse,
  updates: LocalUpdates,
): ListPhotosResponse {
  const merged = withLocalUpdates(page, list, updates);
  const seen = new Set(list.photos.map((p) => p.id));
  const added = merged.photos.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  return { ...merged, photos: [...list.photos, ...added] };
}

async function fetchPage(search: string, signal: AbortSignal) {
  const res = await fetch(`/api/v1/photos?${search}`, { signal });
  return { status: res.status, page: res.ok ? ((await res.json()) as ListPhotosResponse) : null };
}

interface UsePhotoListOptions {
  /** Encoded list parameters, without the cursor. Null holds the first request back. */
  query: string | null;
  /** The rows are about to be replaced: when a first-page request starts and when it settles. */
  onReset: () => void;
}

/**
 * Cursor-paged photo list. At most one page request runs at a time, and starting over aborts it,
 * so a page from an older query can never be appended to a newer list.
 */
export function usePhotoList({ query, onReset }: UsePhotoListOptions) {
  const [data, setData] = useState<ListPhotosResponse | null>(null);
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [nextPageFailed, setNextPageFailed] = useState(false);

  const requestRef = useRef<AbortController | null>(null);
  /** Edits saved since the running request started. */
  const localUpdatesRef = useRef(new Map<string, ApiPhotoSummary>());

  const refresh = useCallback(async () => {
    if (query === null) return;
    requestRef.current?.abort();
    const request = new AbortController();
    requestRef.current = request;
    const updates = new Map<string, ApiPhotoSummary>();
    localUpdatesRef.current = updates;

    setLoading(true);
    setLoadingMore(false);
    setNextPageFailed(false);
    onReset();
    try {
      const { status, page } = await fetchPage(query, request.signal);
      if (request.signal.aborted) return;

      if (page) {
        setData((previous) => withLocalUpdates(page, previous, updates));
        setLoadedQuery(query);
        setLoadError(null);
      } else {
        setLoadError(status === 401 ? "unauthorized" : "failed");
      }
    } catch {
      if (!request.signal.aborted) setLoadError("failed");
    } finally {
      if (requestRef.current === request) {
        requestRef.current = null;
        onReset();
        setLoading(false);
      }
    }
  }, [query, onReset]);

  useEffect(() => {
    void refresh();
    return () => requestRef.current?.abort();
  }, [refresh]);

  const nextCursor = data?.nextCursor ?? null;

  const loadNextPage = useCallback(async () => {
    if (query === null || nextCursor === null || requestRef.current) return;
    const request = new AbortController();
    requestRef.current = request;
    const updates = new Map<string, ApiPhotoSummary>();
    localUpdatesRef.current = updates;

    // A retry keeps the failed flag until it settles, so the Retry button stays mounted and focused.
    setLoadingMore(true);
    try {
      const search = new URLSearchParams(query);
      search.set("cursor", nextCursor);
      const { page } = await fetchPage(search.toString(), request.signal);
      if (request.signal.aborted) return;

      if (page) {
        setData((previous) => previous && appendPage(previous, page, updates));
        setNextPageFailed(false);
      } else {
        setNextPageFailed(true);
      }
    } catch {
      if (!request.signal.aborted) setNextPageFailed(true);
    } finally {
      if (requestRef.current === request) {
        requestRef.current = null;
        setLoadingMore(false);
      }
    }
  }, [query, nextCursor]);

  const updatePhoto = useCallback((updated: ApiPhotoSummary) => {
    localUpdatesRef.current.set(updated.id, updated);
    setData((previous) => previous && mergeUpdatedPhoto(previous, updated));
  }, []);

  // A failed page stays failed until the user retries, so scrolling cannot loop on an outage.
  const canLoadMore =
    nextCursor !== null &&
    loadedQuery === query &&
    !loading &&
    !loadingMore &&
    !nextPageFailed &&
    loadError === null;

  return {
    data,
    loading,
    loadingMore,
    loadError,
    nextPageFailed,
    canLoadMore,
    refresh,
    loadNextPage,
    updatePhoto,
  };
}
