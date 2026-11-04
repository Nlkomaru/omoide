import type { ApiPhotoSummary } from "@omoide/core";
import { useCallback, useEffect, useMemo, useState } from "react";

/** Long enough that holding an arrow key doesn't start downloading every photo it passes. */
const PRELOAD_DELAY_MS = 200;

interface UsePhotoNavigationOptions {
  photos: readonly ApiPhotoSummary[];
  selectedId: string | null;
  onNavigate: (photoId: string) => void;
  hasMore: boolean;
  canLoadMore: boolean;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  loadMore: () => void;
}

/**
 * Steps through the list in its current order, with its filters applied. It stops at either end. A
 * step past the last loaded row waits for the next page, which is what a retry after a failure is.
 */
export function usePhotoNavigation({
  photos,
  selectedId,
  onNavigate,
  hasMore,
  canLoadMore,
  loadingMore,
  loadMoreFailed,
  loadMore,
}: UsePhotoNavigationOptions) {
  const [waitingForNext, setWaitingForNext] = useState(false);
  const index = useMemo(
    () => (selectedId === null ? -1 : photos.findIndex((p) => p.id === selectedId)),
    [photos, selectedId],
  );
  const previousPhoto = index > 0 ? photos[index - 1] : undefined;
  const nextPhoto = index >= 0 ? photos[index + 1] : undefined;
  const previousUrl = previousPhoto?.jpegUrl;
  const nextUrl = nextPhoto?.jpegUrl;

  useEffect(() => {
    if (!waitingForNext) return;
    if (index < 0) {
      setWaitingForNext(false);
    } else if (nextPhoto) {
      setWaitingForNext(false);
      onNavigate(nextPhoto.id);
    } else if (!hasMore || (loadMoreFailed && !loadingMore)) {
      setWaitingForNext(false);
    } else if (canLoadMore) {
      loadMore();
    }
  }, [
    waitingForNext,
    index,
    nextPhoto,
    hasMore,
    loadMoreFailed,
    loadingMore,
    canLoadMore,
    loadMore,
    onNavigate,
  ]);

  useEffect(() => {
    if (!previousUrl && !nextUrl) return;
    const timer = setTimeout(() => {
      for (const url of [previousUrl, nextUrl]) {
        if (url) new Image().src = url;
      }
    }, PRELOAD_DELAY_MS);
    return () => clearTimeout(timer);
  }, [previousUrl, nextUrl]);

  const goPrevious = useCallback(() => {
    setWaitingForNext(false);
    if (previousPhoto) onNavigate(previousPhoto.id);
  }, [previousPhoto, onNavigate]);

  const goNext = useCallback(() => {
    if (nextPhoto) {
      onNavigate(nextPhoto.id);
    } else if (index >= 0 && hasMore) {
      setWaitingForNext(true);
      // A failed page stays failed until asked again, so this is the retry.
      if (loadMoreFailed) loadMore();
    }
  }, [nextPhoto, index, hasMore, loadMoreFailed, loadMore, onNavigate]);

  return {
    index,
    hasPrevious: previousPhoto !== undefined,
    hasNext: nextPhoto !== undefined || (index >= 0 && hasMore),
    waitingForNext,
    /** The last row is on screen and the page after it could not be loaded. */
    nextFailed: index === photos.length - 1 && loadMoreFailed && !waitingForNext,
    goPrevious,
    goNext,
  };
}
