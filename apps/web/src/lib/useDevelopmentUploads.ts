import type { PhotoDevelopmentItem } from "@omoide/core";
import { useEffect, useSyncExternalStore } from "react";
import { createUploadQueue, type UploadItem } from "~/lib/developmentUpload";

type UploadedHandler = (photoId: string, development: PhotoDevelopmentItem) => Promise<void>;

const NO_UPLOADS: readonly UploadItem[] = [];

let items = NO_UPLOADS;
let uploadedHandler: UploadedHandler | null = null;
const listeners = new Set<() => void>();

/** Lives with the page, not a screen: uploads started in the detail view outlast a route change. */
const queue = createUploadQueue({
  onChange: (next) => {
    items = next;
    for (const listener of listeners) listener();
  },
  onUploaded: (photoId, development) => uploadedHandler?.(photoId, development),
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The shared upload queue. A screen that returns finds what finished or failed while it was away. */
export function useDevelopmentUploads(onUploaded: UploadedHandler) {
  const current = useSyncExternalStore(
    subscribe,
    () => items,
    () => NO_UPLOADS,
  );

  useEffect(() => {
    uploadedHandler = onUploaded;
    return () => {
      if (uploadedHandler === onUploaded) uploadedHandler = null;
    };
  }, [onUploaded]);

  return { items: current, queue };
}
