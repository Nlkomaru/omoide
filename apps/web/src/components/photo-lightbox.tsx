import type {
  ApiPhotoDetail,
  ApiPhotoSummary,
  PhotoDevelopmentItem,
  PhotoPostItem,
  SocialPlatform,
} from "@omoide/core";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  LoaderCircle,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { DevelopedVersions } from "~/components/developed-versions";
import { Badge } from "~/components/ui/badge";
import { Button, IconButton } from "~/components/ui/button";
import { TextInput } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { formatBytes, formatCaptureTime, isRecorded } from "~/lib/format";
import {
  countPostsByDevelopment,
  downloadFilename,
  ORIGINAL_VARIANT,
  versionLabels,
  withDevelopment,
  withDevelopmentFavorite,
  withoutDevelopment,
  withPosts,
} from "~/lib/photo-versions";
import { useDevelopmentUploads } from "~/lib/use-development-uploads";

interface PhotoLightboxProps {
  photoId: string | null;
  /** The list's copy of the photo, on screen until its details arrive. */
  summary: ApiPhotoSummary | undefined;
  /** Where the photo sits in the list, from 1. Zero if the list no longer has it. */
  position: number;
  total: number;
  hasPrevious: boolean;
  hasNext: boolean;
  waitingForNext: boolean;
  nextFailed: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  onPhotoUpdated: (updated: ApiPhotoDetail) => void;
}

const EM_DASH = "—";

interface VersionChange {
  photoId: string;
  apply: (detail: ApiPhotoDetail) => ApiPhotoDetail;
}

function formatCount(value: number) {
  return value.toLocaleString("en-US");
}

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  twitter: "Twitter / X",
  blog: "Blog",
  portfolio: "Portfolio",
  other: "Other",
};

const FOCUSABLE_SELECTOR =
  "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])";

/** The default outline colour is too quiet on the dark stage. */
const STAGE_FOCUS = "focus-visible:outline-white";

/** Holding an arrow key still moves along, at a pace the photos have a chance to show. */
const ARROW_REPEAT_MS = 150;

const STAGE_ACTION = `inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-white/15 px-2 text-xs font-medium whitespace-nowrap text-white/85 transition-colors hover:bg-white/10 hover:text-white [&_svg]:size-3.5 ${STAGE_FOCUS}`;

/** Arrow keys in these already mean something, and a pending question shouldn't vanish. */
function keepsArrowKeys(target: EventTarget | null) {
  return (
    target instanceof Element &&
    target.closest("input, textarea, select, [contenteditable], [data-keep-arrow-keys]") !== null
  );
}

export function PhotoLightbox({
  photoId,
  summary,
  position,
  total,
  hasPrevious,
  hasNext,
  waitingForNext,
  nextFailed,
  onPrevious,
  onNext,
  onClose,
  onPhotoUpdated,
}: PhotoLightboxProps) {
  const [loadedDetail, setDetail] = useState<ApiPhotoDetail | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState<string>(ORIGINAL_VARIANT);
  const [newPlatform, setNewPlatform] = useState<SocialPlatform>("instagram");
  const [newPostUrl, setNewPostUrl] = useState("");
  const [newCaption, setNewCaption] = useState("");
  /** The version the user picked for the next post. Null follows the stage. */
  const [postTarget, setPostTarget] = useState<string | null>(null);
  const [submittingPost, setSubmittingPost] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  /** The version whose favorite last failed to save. */
  const [favoriteFailedId, setFavoriteFailedId] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(new Set());
  /** Not cleared by moving to another photo, so a late failure is there on coming back. */
  const [deleteFailedId, setDeleteFailedId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const postTargetId = useId();
  /** The photo on screen right now, for responses that arrive after it may have changed. */
  const detailRef = useRef<ApiPhotoDetail | null>(null);
  /**
   * Uploads and deletes saved this session, in order. A detail request that was already running can
   * answer with the photo as it was, so its response gets the ones saved since it started.
   */
  const savedVersionChangesRef = useRef<VersionChange[]>([]);
  const favoritesInFlightRef = useRef(new Set<string>());
  const lastArrowRef = useRef(0);
  // A render can see the new photo before the effect below has cleared the old one's details.
  const detail = loadedDetail?.id === photoId ? loadedDetail : null;

  const showDetail = useCallback((next: ApiPhotoDetail | null) => {
    detailRef.current = next;
    setDetail(next);
  }, []);

  /**
   * Applies a saved change to the photo it belongs to. If the view has moved on, nothing on screen
   * changes and only that photo's table row is brought up to date.
   */
  const applySavedChange = useCallback(
    async (targetId: string, update: (current: ApiPhotoDetail) => ApiPhotoDetail) => {
      const current = detailRef.current;
      if (current?.id === targetId) {
        const next = update(current);
        showDetail(next);
        onPhotoUpdated(next);
        return;
      }
      try {
        const res = await fetch(`/api/v1/photos/${targetId}`);
        if (res.ok) onPhotoUpdated((await res.json()) as ApiPhotoDetail);
      } catch {
        // The row catches up on the next list refresh.
      }
    },
    [onPhotoUpdated, showDetail],
  );

  const handleUploaded = useCallback(
    async (targetId: string, development: PhotoDevelopmentItem) => {
      savedVersionChangesRef.current.push({
        photoId: targetId,
        apply: (current) => withDevelopment(current, development),
      });
      await applySavedChange(targetId, (current) => withDevelopment(current, development));
    },
    [applySavedChange],
  );

  const uploads = useDevelopmentUploads(handleUploaded);

  useEffect(() => {
    showDetail(null);
    setLoadFailed(false);
    setSelectedVariantId(ORIGINAL_VARIANT);
    setPostTarget(null);
    setPostError(null);
    setFavoriteFailedId(null);
    // An unsent post is about the photo it was typed under.
    setNewPostUrl("");
    setNewCaption("");
    if (!photoId) return;

    let cancelled = false;
    const changesAtStart = savedVersionChangesRef.current.length;
    fetch(`/api/v1/photos/${photoId}`)
      .then((res) => (res.ok ? (res.json() as Promise<ApiPhotoDetail>) : null))
      .then((data) => {
        if (cancelled) return;
        if (data) {
          const savedSince = savedVersionChangesRef.current
            .slice(changesAtStart)
            .filter((change) => change.photoId === photoId);
          showDetail(savedSince.reduce((shown, change) => change.apply(shown), data));
        } else {
          setLoadFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [photoId, showDetail]);

  useEffect(() => {
    if (!photoId) return;

    function onKeyDown(e: KeyboardEvent) {
      // Escape during IME composition cancels the composition, not the dialog.
      if (e.key === "Escape" && !e.isComposing) {
        onClose();
        return;
      }
      if (
        (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
        !e.isComposing &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        !keepsArrowKeys(e.target)
      ) {
        e.preventDefault();
        if (e.repeat && e.timeStamp - lastArrowRef.current < ARROW_REPEAT_MS) return;
        lastArrowRef.current = e.timeStamp;
        if (e.key === "ArrowLeft") onPrevious();
        else onNext();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      const active = document.activeElement;
      const outside = !panelRef.current.contains(active);
      // The panel itself holds focus right after opening, and Shift+Tab from there must wrap too.
      if (e.shiftKey && (outside || active === first || active === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (outside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [photoId, onClose, onPrevious, onNext]);

  const isOpen = photoId !== null;
  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement;
    // The panel, not a control: focusing a control can draw its ring after a mouse click. Stacked
    // layouts place the controls below the stage, so keep the photo in view.
    panelRef.current?.focus({ preventScroll: true });

    return () => {
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [isOpen]);

  // Moving on can remove the control that held the focus, which would leave the dialog behind.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the rows have just changed
  useEffect(() => {
    if (isOpen && document.activeElement === document.body) {
      panelRef.current?.focus({ preventScroll: true });
    }
  }, [isOpen, photoId, detail === null]);

  if (!photoId) return null;

  const photo = detail ?? (summary?.id === photoId ? summary : null);
  const postOf = postTarget ?? selectedVariantId;
  const activeDevelopment = detail?.developments.find((d) => d.id === selectedVariantId);
  const activeImageUrl = activeDevelopment ? activeDevelopment.url : (photo?.jpegUrl ?? "");
  const activeWidth = activeDevelopment ? activeDevelopment.width : (photo?.width ?? 0);
  const activeHeight = activeDevelopment ? activeDevelopment.height : (photo?.height ?? 0);
  const activeByteSize = activeDevelopment
    ? activeDevelopment.byteSize
    : (photo?.jpegByteSize ?? 0);

  async function handleToggleFavorite() {
    if (!detail) return;
    const res = await fetch(`/api/v1/photos/${detail.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isFavorite: !detail.isFavorite }),
    });
    if (res.ok) {
      const { isFavorite, updatedAt } = (await res.json()) as ApiPhotoDetail;
      await applySavedChange(detail.id, (current) => ({ ...current, isFavorite, updatedAt }));
    }
  }

  /** Updates the version's star on screen and in the table's developed-favorite summary. */
  function showVersionFavorite(
    targetId: string,
    developmentId: string,
    isFavorite: boolean,
    notifyTable = false,
  ) {
    const current = detailRef.current;
    if (current?.id === targetId) {
      const next = withDevelopmentFavorite(current, developmentId, isFavorite);
      showDetail(next);
      if (notifyTable) onPhotoUpdated(next);
    }
  }

  async function handleToggleVersionFavorite(development: PhotoDevelopmentItem) {
    const { id, photoId: targetId, isFavorite: previous } = development;
    if (favoritesInFlightRef.current.has(id)) return;
    favoritesInFlightRef.current.add(id);
    setFavoriteFailedId(null);
    showVersionFavorite(targetId, id, !previous);

    let saved: boolean | null = null;
    try {
      const res = await fetch(`/api/v1/photos/${targetId}/developments/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isFavorite: !previous }),
      });
      if (res.ok) {
        const body = (await res.json()) as { development: PhotoDevelopmentItem };
        saved = body.development.isFavorite;
      }
    } catch {
      // Handled below, the same as a refused request.
    } finally {
      favoritesInFlightRef.current.delete(id);
    }

    if (saved !== null) {
      savedVersionChangesRef.current.push({
        photoId: targetId,
        apply: (current) => withDevelopmentFavorite(current, id, saved),
      });
      await applySavedChange(targetId, (current) => withDevelopmentFavorite(current, id, saved));
    } else {
      showVersionFavorite(targetId, id, previous);
      if (detailRef.current?.id === targetId) {
        setFavoriteFailedId(id);
      }
    }
  }

  async function handleDeleteVersion(development: PhotoDevelopmentItem) {
    const { id, photoId: targetId } = development;
    const leaveVersion = () => {
      setSelectedVariantId((variant) => (variant === id ? ORIGINAL_VARIANT : variant));
      setPostTarget((target) => (target === id ? null : target));
    };
    setDeleteFailedId(null);
    setDeletingIds((ids) => new Set(ids).add(id));
    try {
      const res = await fetch(`/api/v1/photos/${targetId}/developments/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        const { deletedVersionLabel, updatedAt } = (await res.json()) as {
          deletedVersionLabel: string;
          updatedAt: number;
        };
        savedVersionChangesRef.current.push({
          photoId: targetId,
          apply: (current) => withoutDevelopment(current, id, deletedVersionLabel),
        });
        leaveVersion();
        await applySavedChange(targetId, (current) => ({
          ...withoutDevelopment(current, id, deletedVersionLabel),
          updatedAt,
        }));
      } else if (res.status === 404) {
        // Already gone, from another tab or the CLI. What's stored now is the answer.
        const fresh = await fetch(`/api/v1/photos/${targetId}`);
        if (!fresh.ok) throw new Error("Could not reload the photo");
        const stored = (await fresh.json()) as ApiPhotoDetail;
        leaveVersion();
        await applySavedChange(targetId, () => stored);
      } else {
        setDeleteFailedId(id);
      }
    } catch {
      setDeleteFailedId(id);
    } finally {
      setDeletingIds((ids) => {
        const remaining = new Set(ids);
        remaining.delete(id);
        return remaining;
      });
    }
  }

  async function handleAddPost(e: React.FormEvent) {
    e.preventDefault();
    if (!detail || !newPostUrl.trim()) return;
    const targetId = detail.id;
    const stillOpen = () => detailRef.current?.id === targetId;
    const sentUrl = newPostUrl;
    const sentCaption = newCaption;
    setSubmittingPost(true);
    setPostError(null);
    try {
      const res = await fetch(`/api/v1/photos/${targetId}/posts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          platform: newPlatform,
          postUrl: newPostUrl.trim(),
          caption: newCaption.trim() || null,
          developmentId: postOf !== ORIGINAL_VARIANT ? postOf : null,
        }),
      });
      if (res.ok) {
        const { post } = (await res.json()) as { post: PhotoPostItem };
        const open = stillOpen();
        await applySavedChange(targetId, (current) =>
          withPosts(current, [post, ...current.posts.filter((p) => p.id !== post.id)]),
        );
        // Whatever was typed since, perhaps for another photo, isn't this post.
        setNewPostUrl((url) => (url === sentUrl ? "" : url));
        setNewCaption((caption) => (caption === sentCaption ? "" : caption));
        if (open) setPostTarget(null);
      } else if (stillOpen()) {
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
        setPostError(
          typeof body?.error === "string" ? body.error : `Could not add the post (${res.status}).`,
        );
      }
    } catch {
      if (stillOpen()) setPostError("Could not add the post. Check your connection.");
    } finally {
      setSubmittingPost(false);
    }
  }

  async function handleDeletePost(postId: string) {
    if (!detail) return;
    const res = await fetch(`/api/v1/photos/${detail.id}/posts/${postId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      await applySavedChange(detail.id, (current) =>
        withPosts(
          current,
          current.posts.filter((p) => p.id !== postId),
        ),
      );
    }
  }

  const exif = photo?.exifJson;
  // The count comes with the summary, so the stage holds still while the versions load.
  const hasVariants = (photo?.developmentsCount ?? 0) > 0;
  const labels = versionLabels(detail?.developments ?? []);
  const photoUploads = uploads.items.filter((u) => u.photoId === photoId);

  return (
    // Keyboard users close with Escape, handled by the window listener above.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the backdrop click is a pointer-only shortcut
    <div
      role="dialog"
      aria-modal="true"
      aria-label={photo?.originalFilename ?? "Photo details"}
      className="fixed inset-0 z-50 bg-black/50 md:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      // A file dropped just outside the upload area must not navigate away from the page.
      onDragOver={(e) => {
        if (e.defaultPrevented || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "none";
      }}
      onDrop={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="flex h-full w-full flex-col overflow-y-auto overscroll-contain bg-surface outline-none md:rounded-md md:shadow-xl lg:flex-row lg:overflow-hidden"
      >
        {/* Stage */}
        <div
          className={`flex shrink-0 flex-col bg-zinc-950 text-white lg:h-auto lg:min-w-0 lg:flex-1 lg:shrink ${
            photo ? "" : "h-[60dvh]"
          }`}
        >
          {hasVariants && (
            <div className="flex shrink-0 px-3 py-2">
              <fieldset className="flex max-w-full min-w-0 gap-0.5 overflow-x-auto rounded-md border-0 bg-white/10 p-0.5">
                <legend className="sr-only">Version</legend>
                <VariantButton
                  selected={selectedVariantId === ORIGINAL_VARIANT}
                  onSelect={() => setSelectedVariantId(ORIGINAL_VARIANT)}
                >
                  Original
                </VariantButton>
                {detail?.developments.map((dev) => (
                  <VariantButton
                    key={dev.id}
                    selected={selectedVariantId === dev.id}
                    onSelect={() => setSelectedVariantId(dev.id)}
                  >
                    {dev.isFavorite && (
                      <>
                        <Star aria-hidden="true" className="size-3 fill-star text-star" />
                        <span className="sr-only">Favorite: </span>
                      </>
                    )}
                    <span title={labels.get(dev.id)} className="max-w-40 truncate">
                      {labels.get(dev.id)}
                    </span>
                  </VariantButton>
                ))}
              </fieldset>
            </div>
          )}

          {/* Stacked layouts size the stage to the photo, so a landscape shot gets no black bands. */}
          <div
            style={
              photo && activeWidth > 0 && activeHeight > 0
                ? ({ "--stage-aspect": `${activeWidth} / ${activeHeight}` } as CSSProperties)
                : undefined
            }
            className={`relative min-h-0 ${
              photo
                ? "aspect-(--stage-aspect,3/2) max-h-[60dvh] lg:aspect-auto lg:max-h-none lg:flex-1"
                : "flex-1"
            }`}
          >
            {photo ? (
              <>
                {/* The table already loaded the thumbnail, so a step shows the right photo at once. */}
                {!activeDevelopment && photo.thumbUrl && (
                  <img
                    src={photo.thumbUrl}
                    alt=""
                    className="absolute inset-0 size-full object-contain"
                  />
                )}
                {/* Keyed so a slow download doesn't leave the last photo under this one's name. */}
                <img
                  key={activeImageUrl}
                  src={activeImageUrl}
                  alt={photo.originalFilename}
                  className="absolute inset-0 size-full object-contain"
                />
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-white/70">
                {loadFailed ? (
                  <p role="alert">This photo could not be loaded.</p>
                ) : (
                  <p role="status">Loading…</p>
                )}
              </div>
            )}
            {position > 0 && (
              <>
                <StageStepButton
                  label="Previous photo"
                  side="left"
                  available={hasPrevious}
                  onStep={onPrevious}
                >
                  <ChevronLeft aria-hidden="true" />
                </StageStepButton>
                <StageStepButton
                  label="Next photo"
                  side="right"
                  available={hasNext}
                  busy={waitingForNext}
                  onStep={onNext}
                >
                  {waitingForNext ? (
                    <LoaderCircle aria-hidden="true" className="animate-spin" />
                  ) : (
                    <ChevronRight aria-hidden="true" />
                  )}
                </StageStepButton>
              </>
            )}
          </div>

          {nextFailed && (
            <p role="alert" className="shrink-0 px-3 pt-2 text-xs text-white/85">
              More photos could not be loaded. Next tries again.
            </p>
          )}

          {photo && (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="flex flex-wrap gap-x-3 text-xs text-white/70 tabular-nums">
                {position > 0 && (
                  <span>
                    <span aria-hidden="true">
                      {formatCount(position)} / {formatCount(total)}
                    </span>
                    <span aria-live="polite" className="sr-only">
                      Photo {formatCount(position)} of {formatCount(total)}:{" "}
                      {photo.originalFilename}
                    </span>
                  </span>
                )}
                <span>
                  {activeWidth} × {activeHeight} px · {formatBytes(activeByteSize)}
                </span>
              </span>
              <div className="flex items-center gap-2">
                <a
                  href={activeImageUrl}
                  download={downloadFilename(photo.originalFilename, activeDevelopment)}
                  className={STAGE_ACTION}
                >
                  <Download aria-hidden="true" />
                  Download {activeDevelopment ? activeDevelopment.format.toUpperCase() : "JPEG"}
                </a>
                {photo.hasRaw && photo.rawUrl && (
                  <a href={photo.rawUrl} className={STAGE_ACTION}>
                    <Download aria-hidden="true" />
                    RAW
                    {photo.rawByteSize != null && (
                      <span className="font-normal text-white/70 tabular-nums">
                        {formatBytes(photo.rawByteSize)}
                      </span>
                    )}
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Inspector */}
        <div className="border-line bg-surface lg:w-88 lg:shrink-0 lg:overflow-y-auto lg:overscroll-contain lg:border-l">
          <div className="sticky top-0 z-10 flex items-start gap-2 bg-surface px-4 py-3">
            {photo && (
              <h2 className="min-w-0 py-1 text-sm font-semibold break-all text-ink">
                {photo.originalFilename}
              </h2>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              {photo && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Favorite photo"
                  title="Favorite this photo"
                  aria-pressed={photo.isFavorite}
                  onClick={handleToggleFavorite}
                >
                  <Star
                    aria-hidden="true"
                    className={photo.isFavorite ? "fill-star text-star" : ""}
                  />
                  Photo
                </Button>
              )}
              <IconButton aria-label="Close" onClick={onClose}>
                <X aria-hidden="true" />
              </IconButton>
            </div>
          </div>

          {photo && (
            <dl className="border-t border-line px-4 text-xs">
              <Field label="Captured">
                {formatCaptureTime(photo.takenAt, photo.timezoneOffset)} ({photo.timezoneOffset})
              </Field>
              <Field label="Camera">
                {photo.cameraMake ?? "SONY"} {photo.cameraModel ?? "ILCE-7C"}
              </Field>
              <Field label="Lens">{photo.lensModel ?? EM_DASH}</Field>
              <Field label="Focal length">{withUnit(photo.focalLengthMm, " mm")}</Field>
              <Field label="Aperture">
                {isRecorded(photo.fNumber) ? `f/${photo.fNumber}` : EM_DASH}
              </Field>
              <Field label="Shutter">{formatShutter(photo.exposureTime)}</Field>
              <Field label="ISO">{isRecorded(photo.iso) ? photo.iso : EM_DASH}</Field>
              <Field label="35mm equivalent">{withUnit(exif?.focalLength35mm, " mm")}</Field>
              <Field label="Exposure compensation">
                {formatExposureCompensation(exif?.exposureCompensation)}
              </Field>
              <Field label="White balance">{exif?.whiteBalance || EM_DASH}</Field>
              <Field label="Metering">{exif?.meteringMode || EM_DASH}</Field>
            </dl>
          )}

          {photo && !detail && (
            <p
              role={loadFailed ? "alert" : "status"}
              className={`border-t border-line px-4 py-3 text-xs ${
                loadFailed ? "text-danger" : "text-ink-faint"
              }`}
            >
              {loadFailed
                ? "This photo's versions and posts could not be loaded."
                : "Loading versions and posts…"}
            </p>
          )}

          {detail && (
            <>
              <DevelopedVersions
                developments={detail.developments}
                labels={labels}
                hasRaw={detail.hasRaw}
                selectedVariantId={selectedVariantId}
                postCounts={countPostsByDevelopment(detail.posts)}
                uploads={photoUploads}
                favoriteFailedId={favoriteFailedId}
                deletingIds={deletingIds}
                deleteFailedId={deleteFailedId}
                onSelect={setSelectedVariantId}
                onToggleFavorite={handleToggleVersionFavorite}
                onDelete={handleDeleteVersion}
                onAddFiles={(files) =>
                  uploads.queue.add(
                    detail.id,
                    files,
                    detail.developments.map((d) => d.sha256),
                  )
                }
                onRetryUpload={uploads.queue.retry}
                onDismissUpload={uploads.queue.dismiss}
                onClearFinishedUploads={() => uploads.queue.dismissFinished(detail.id)}
              />

              <section className="border-t border-line px-4 py-3">
                <SectionHeading count={detail.posts.length}>Posts</SectionHeading>

                {detail.posts.length === 0 ? (
                  <p className="mt-1 text-xs text-ink-faint">Not posted anywhere yet.</p>
                ) : (
                  <ul className="mt-1">
                    {detail.posts.map((post) => (
                      <li key={post.id} className="flex items-start gap-2 py-1 text-xs">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <Badge className="shrink-0">{PLATFORM_LABELS[post.platform]}</Badge>
                            <a
                              href={post.postUrl}
                              target="_blank"
                              rel="noreferrer"
                              title={post.postUrl}
                              className="flex min-w-0 items-center gap-1 text-accent hover:underline"
                            >
                              <span className="truncate">{post.postUrl}</span>
                              <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
                            </a>
                          </div>
                          <PostOwner
                            developmentId={post.developmentId}
                            deletedVersionLabel={post.deletedVersionLabel}
                            labels={labels}
                            onSelect={setSelectedVariantId}
                          />
                          {post.caption && (
                            <p className="mt-0.5 truncate text-ink-faint">{post.caption}</p>
                          )}
                        </div>
                        <IconButton
                          variant="danger-ghost"
                          size="sm"
                          className="-mt-1 -mr-2"
                          aria-label={`Remove ${PLATFORM_LABELS[post.platform]} post`}
                          onClick={() => handleDeletePost(post.id)}
                        >
                          <Trash2 aria-hidden="true" />
                        </IconButton>
                      </li>
                    ))}
                  </ul>
                )}

                <form onSubmit={handleAddPost} className="mt-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <label htmlFor={postTargetId} className="shrink-0 text-xs text-ink-muted">
                      Post of
                    </label>
                    <Select
                      size="sm"
                      id={postTargetId}
                      className="min-w-0 flex-1"
                      value={postOf}
                      onChange={(e) => setPostTarget(e.target.value)}
                    >
                      <option value={ORIGINAL_VARIANT}>Original</option>
                      {detail.developments.map((dev) => (
                        <option key={dev.id} value={dev.id}>
                          {labels.get(dev.id)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="flex gap-2">
                    <Select
                      size="sm"
                      aria-label="Platform"
                      className="w-28 shrink-0"
                      value={newPlatform}
                      onChange={(e) => setNewPlatform(e.target.value as SocialPlatform)}
                    >
                      {Object.entries(PLATFORM_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                    <TextInput
                      size="sm"
                      type="url"
                      required
                      aria-label="Post URL"
                      placeholder="https://"
                      className="min-w-0 flex-1"
                      value={newPostUrl}
                      onChange={(e) => setNewPostUrl(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2">
                    <TextInput
                      size="sm"
                      aria-label="Note"
                      placeholder="Note (optional)"
                      className="min-w-0 flex-1"
                      value={newCaption}
                      onChange={(e) => setNewCaption(e.target.value)}
                    />
                    <Button type="submit" size="sm" disabled={submittingPost}>
                      Add
                    </Button>
                  </div>
                  {postError && (
                    <p role="alert" className="text-xs text-danger">
                      {postError}
                    </p>
                  )}
                </form>
              </section>

              <p className="border-t border-line px-4 py-3 font-mono text-[11px] break-all text-ink-faint">
                <span className="sr-only">Photo ID: </span>
                {detail.id}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** What a post belongs to. A reference that isn't in the list has no version to switch to. */
function PostOwner({
  developmentId,
  deletedVersionLabel,
  labels,
  onSelect,
}: {
  developmentId: string | null;
  deletedVersionLabel: string | null;
  labels: ReadonlyMap<string, string>;
  onSelect: (variantId: string) => void;
}) {
  if (!developmentId && deletedVersionLabel) {
    return (
      <p title={deletedVersionLabel} className="mt-0.5 truncate text-ink-faint">
        Post of deleted version {deletedVersionLabel}
      </p>
    );
  }
  const label = developmentId ? labels.get(developmentId) : "Original";
  if (!label) {
    return <p className="mt-0.5 text-ink-faint">Post of Unknown version</p>;
  }
  return (
    <button
      type="button"
      title={`Show ${label}`}
      onClick={() => onSelect(developmentId ?? ORIGINAL_VARIANT)}
      className="group mt-0.5 flex max-w-full gap-1 rounded-sm text-left"
    >
      <span className="shrink-0 text-ink-faint">Post of </span>
      <span className="min-w-0 truncate text-ink-muted underline decoration-line-strong underline-offset-2 group-hover:text-ink group-hover:decoration-current">
        {label}
      </span>
    </button>
  );
}

/**
 * Stays focusable at the end of the list, so a keyboard user who walks into it keeps their place.
 * Faint rather than busy at the end, and it sits over the photo's edge rather than taking width.
 */
function StageStepButton({
  label,
  side,
  available,
  busy = false,
  onStep,
  children,
}: {
  label: string;
  side: "left" | "right";
  available: boolean;
  busy?: boolean;
  onStep: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={available ? label : undefined}
      aria-disabled={!available}
      aria-busy={busy}
      onClick={() => {
        if (available) onStep();
      }}
      className={`absolute top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-md bg-black/45 text-white/90 transition-colors hover:bg-black/70 hover:text-white aria-disabled:bg-black/20 aria-disabled:text-white/25 aria-disabled:hover:bg-black/20 aria-disabled:hover:text-white/25 [&_svg]:size-5 ${STAGE_FOCUS} ${
        side === "left" ? "left-2" : "right-2"
      }`}
    >
      {children}
    </button>
  );
}

function VariantButton({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-sm px-2 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-offset-0 ${STAGE_FOCUS} ${
        selected ? "bg-white/20 text-white" : "text-white/70 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-1.5 last:border-b-0">
      <dt className="shrink-0 text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-right break-words text-ink tabular-nums">{children}</dd>
    </div>
  );
}

function SectionHeading({ count, children }: { count: number; children: ReactNode }) {
  return (
    <h3 className="text-sm font-medium text-ink">
      {children} <span className="font-normal text-ink-faint tabular-nums">{count}</span>
    </h3>
  );
}

function withUnit(value: number | null | undefined, unit: string): string {
  return isRecorded(value) ? `${value}${unit}` : EM_DASH;
}

/** The stored value is "1/250" below one second and already carries the unit from "2.5s" up. */
function formatShutter(exposureTime: string | null): string {
  if (!exposureTime) return EM_DASH;
  return exposureTime.endsWith("s") ? exposureTime : `${exposureTime}s`;
}

function formatExposureCompensation(ev: number | null | undefined): string {
  if (ev == null) return EM_DASH;
  return `${ev > 0 ? "+" : ""}${ev} EV`;
}
