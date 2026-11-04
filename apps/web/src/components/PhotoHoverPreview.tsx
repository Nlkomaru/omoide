import type { ApiPhotoSummary } from "@omoide/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BlurhashImage } from "~/components/BlurhashImage";

const SHOW_DELAY_MS = 120;
/** Long enough to cross the gap between two thumbnails without the preview blinking. */
const LEAVE_GRACE_MS = 80;
const MAX_LONG_SIDE_PX = 420;
const MAX_VIEWPORT_WIDTH = 0.45;
const MAX_VIEWPORT_HEIGHT = 0.7;
const ANCHOR_GAP_PX = 8;
const VIEWPORT_MARGIN_PX = 8;

type PreviewSource = "pointer" | "focus";

interface PreviewTarget {
  photo: ApiPhotoSummary;
  left: number;
  top: number;
  width: number;
  height: number;
  side: "left" | "right";
}

export interface PhotoPreviewControls {
  schedule: (photo: ApiPhotoSummary, anchor: HTMLElement, source: PreviewSource) => void;
  /** The pointer left a thumbnail: hide soon, unless it reaches another thumbnail first. */
  leave: () => void;
  hide: () => void;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

/**
 * Opens beside the row's identifying columns where the table marks a `data-preview-start` cell;
 * that cell is hidden on narrow tables, so the preview falls back to the thumbnail's side. Stays
 * inside `data-preview-bounds`, which keeps the navbar and toolbar readable.
 */
function placePreview(photo: ApiPhotoSummary, anchorElement: HTMLElement): PreviewTarget {
  const anchor = anchorElement.getBoundingClientRect();
  const start = anchorElement
    .closest("tr")
    ?.querySelector("[data-preview-start]")
    ?.getBoundingClientRect();
  const bounds = anchorElement.closest("[data-preview-bounds]")?.getBoundingClientRect();
  const topLimit = (bounds?.top ?? 0) + VIEWPORT_MARGIN_PX;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const aspect = photo.width > 0 && photo.height > 0 ? photo.width / photo.height : 3 / 2;

  const maxWidth = Math.min(MAX_LONG_SIDE_PX, viewportWidth * MAX_VIEWPORT_WIDTH);
  const maxHeight = Math.min(
    MAX_LONG_SIDE_PX,
    viewportHeight * MAX_VIEWPORT_HEIGHT,
    viewportHeight - VIEWPORT_MARGIN_PX - topLimit,
  );
  const width = Math.round(Math.min(maxWidth, maxHeight * aspect));
  const height = Math.round(width / aspect);

  const rightEdge = viewportWidth - VIEWPORT_MARGIN_PX - width;
  const rightPosition = start?.width ? start.left : anchor.right + ANCHOR_GAP_PX;
  const side = rightPosition <= rightEdge ? "right" : "left";
  const left =
    side === "right"
      ? rightPosition
      : clamp(anchor.left - ANCHOR_GAP_PX - width, VIEWPORT_MARGIN_PX, rightEdge);

  const top = clamp(
    anchor.top + anchor.height / 2 - height / 2,
    topLimit,
    Math.max(topLimit, viewportHeight - VIEWPORT_MARGIN_PX - height),
  );

  return { photo, left, top, width, height, side };
}

/** State lives at page level so a single floating preview serves every table row. */
export function usePhotoHoverPreview(disabled: boolean) {
  const [target, setTarget] = useState<PreviewTarget | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSourceRef = useRef<PreviewSource | null>(null);
  const disabledRef = useRef(disabled);
  const visibleRef = useRef(false);

  const cancelPending = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingSourceRef.current = null;
  }, []);

  const show = useCallback((next: PreviewTarget | null) => {
    visibleRef.current = next !== null;
    setTarget(next);
  }, []);

  const hide = useCallback(() => {
    cancelPending();
    show(null);
  }, [cancelPending, show]);

  const leave = useCallback(() => {
    cancelPending();
    if (!visibleRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      show(null);
    }, LEAVE_GRACE_MS);
  }, [cancelPending, show]);

  const schedule = useCallback<PhotoPreviewControls["schedule"]>(
    (photo, anchor, source) => {
      if (disabledRef.current) return;
      cancelPending();
      const reveal = () => {
        if (anchor.isConnected) show(placePreview(photo, anchor));
      };
      // Comparing photos down the column: an open preview swaps at once instead of blinking.
      if (visibleRef.current) {
        reveal();
        return;
      }
      pendingSourceRef.current = source;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        pendingSourceRef.current = null;
        reveal();
      }, SHOW_DELAY_MS);
    },
    [cancelPending, show],
  );

  // A passive effect on purpose: the detail view returns focus to the thumbnail in its own effect
  // cleanup, which runs before this body, so closing it does not reopen the preview.
  useEffect(() => {
    disabledRef.current = disabled;
    if (disabled) hide();
  }, [disabled, hide]);

  useEffect(() => {
    function onScroll() {
      // Tabbing to an off-screen thumbnail scrolls it into view just after focus. That scroll must
      // not cancel the pending preview, which measures the anchor when it fires.
      if (pendingSourceRef.current !== "focus") cancelPending();
      show(null);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") hide();
    }

    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", hide);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", hide);
      window.removeEventListener("keydown", onKeyDown);
      cancelPending();
    };
  }, [cancelPending, hide, show]);

  const controls = useMemo<PhotoPreviewControls>(
    () => ({ schedule, leave, hide }),
    [schedule, leave, hide],
  );

  return { target, controls };
}

export function PhotoHoverPreview({ target }: { target: PreviewTarget | null }) {
  if (!target) return null;
  const { photo, left, top, width, height, side } = target;

  return (
    // Not keyed by photo: swapping keeps this element, so only a fresh open plays the entrance.
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed z-40 overflow-hidden rounded-md border border-line bg-surface shadow-lg transition-[opacity,scale] duration-100 ease-out starting:scale-95 starting:opacity-0 ${
        side === "right" ? "origin-left" : "origin-right"
      }`}
      style={{ left, top, width, height }}
    >
      <BlurhashImage
        key={photo.id}
        src={photo.thumbUrl ?? photo.jpegUrl}
        alt=""
        blurhash={photo.blurhash}
        width={photo.width}
        height={photo.height}
        className="size-full [&_img]:duration-100"
      />
    </div>
  );
}
