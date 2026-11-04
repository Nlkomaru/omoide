import type { ApiPhotoDetail, PhotoPostItem, SocialPlatform } from "@omoide/core";
import { Download, ExternalLink, Star, Trash2, X } from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { Badge, Button, IconButton, Select, TextInput } from "~/components/ui";
import { formatBytes, formatCaptureTime, isRecorded } from "~/lib/format";

interface PhotoLightboxProps {
  photoId: string | null;
  onClose: () => void;
  onPhotoUpdated: (updated: ApiPhotoDetail) => void;
}

const EM_DASH = "—";

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

const STAGE_ACTION = `inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-white/15 px-2 text-xs font-medium whitespace-nowrap text-white/85 transition-colors hover:bg-white/10 hover:text-white [&_svg]:size-3.5 ${STAGE_FOCUS}`;

export function PhotoLightbox({ photoId, onClose, onPhotoUpdated }: PhotoLightboxProps) {
  const [detail, setDetail] = useState<ApiPhotoDetail | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState<string>("original");
  const [newPlatform, setNewPlatform] = useState<SocialPlatform>("instagram");
  const [newPostUrl, setNewPostUrl] = useState("");
  const [newCaption, setNewCaption] = useState("");
  const [submittingPost, setSubmittingPost] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDetail(null);
    setLoadFailed(false);
    setSelectedVariantId("original");
    if (!photoId) return;

    let cancelled = false;
    fetch(`/api/v1/photos/${photoId}`)
      .then((res) => (res.ok ? (res.json() as Promise<ApiPhotoDetail>) : null))
      .then((data) => {
        if (cancelled) return;
        if (data) {
          setDetail(data);
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
  }, [photoId]);

  useEffect(() => {
    if (!photoId) return;

    function onKeyDown(e: KeyboardEvent) {
      // Escape during IME composition cancels the composition, not the dialog.
      if (e.key === "Escape" && !e.isComposing) {
        onClose();
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
  }, [photoId, onClose]);

  useEffect(() => {
    if (!photoId) return;

    const previouslyFocused = document.activeElement;
    // The panel, not a control: focusing a control can draw its ring after a mouse click. Stacked
    // layouts place the controls below the stage, so keep the photo in view.
    panelRef.current?.focus({ preventScroll: true });

    return () => {
      if (previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [photoId]);

  if (!photoId) return null;

  const activeDevelopment = detail?.developments.find((d) => d.id === selectedVariantId);
  const activeImageUrl = activeDevelopment ? activeDevelopment.url : (detail?.jpegUrl ?? "");
  const activeWidth = activeDevelopment ? activeDevelopment.width : (detail?.width ?? 0);
  const activeHeight = activeDevelopment ? activeDevelopment.height : (detail?.height ?? 0);
  const activeByteSize = activeDevelopment
    ? activeDevelopment.byteSize
    : (detail?.jpegByteSize ?? 0);

  async function handleToggleFavorite() {
    if (!detail) return;
    const res = await fetch(`/api/v1/photos/${detail.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isFavorite: !detail.isFavorite }),
    });
    if (res.ok) {
      const updated = (await res.json()) as ApiPhotoDetail;
      setDetail(updated);
      onPhotoUpdated(updated);
    }
  }

  async function handleAddPost(e: React.FormEvent) {
    e.preventDefault();
    if (!detail || !newPostUrl.trim()) return;
    setSubmittingPost(true);
    try {
      const res = await fetch(`/api/v1/photos/${detail.id}/posts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          platform: newPlatform,
          postUrl: newPostUrl.trim(),
          caption: newCaption.trim() || null,
          developmentId: selectedVariantId !== "original" ? selectedVariantId : null,
        }),
      });
      if (res.ok) {
        const { post } = (await res.json()) as { post: PhotoPostItem };
        const nextPosts = [post, ...detail.posts];
        const nextPlatforms = Array.from(new Set(nextPosts.map((p) => p.platform)));
        const updated: ApiPhotoDetail = {
          ...detail,
          posts: nextPosts,
          postsCount: nextPosts.length,
          platforms: nextPlatforms,
        };
        setDetail(updated);
        onPhotoUpdated(updated);
        setNewPostUrl("");
        setNewCaption("");
      }
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
      const nextPosts = detail.posts.filter((p) => p.id !== postId);
      const nextPlatforms = Array.from(new Set(nextPosts.map((p) => p.platform)));
      const updated: ApiPhotoDetail = {
        ...detail,
        posts: nextPosts,
        postsCount: nextPosts.length,
        platforms: nextPlatforms,
      };
      setDetail(updated);
      onPhotoUpdated(updated);
    }
  }

  const exif = detail?.exifJson;
  const hasVariants = (detail?.developments.length ?? 0) > 0;

  return (
    // Keyboard users close with Escape, handled by the window listener above.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the backdrop click is a pointer-only shortcut
    <div
      role="dialog"
      aria-modal="true"
      aria-label={detail?.originalFilename ?? "Photo details"}
      className="fixed inset-0 z-50 bg-black/50 md:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
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
            detail ? "" : "h-[60dvh]"
          }`}
        >
          {hasVariants && detail && (
            <div className="flex shrink-0 px-3 py-2">
              <fieldset className="flex max-w-full gap-0.5 overflow-x-auto rounded-md border-0 bg-white/10 p-0.5">
                <legend className="sr-only">Version</legend>
                <VariantButton
                  selected={selectedVariantId === "original"}
                  onSelect={() => setSelectedVariantId("original")}
                >
                  Original
                </VariantButton>
                {detail.developments.map((dev) => (
                  <VariantButton
                    key={dev.id}
                    selected={selectedVariantId === dev.id}
                    onSelect={() => setSelectedVariantId(dev.id)}
                  >
                    {dev.format.toUpperCase()} · {dev.label}
                  </VariantButton>
                ))}
              </fieldset>
            </div>
          )}

          {/* Stacked layouts size the stage to the photo, so a landscape shot gets no black bands. */}
          <div
            style={
              detail && activeWidth > 0 && activeHeight > 0
                ? ({ "--stage-aspect": `${activeWidth} / ${activeHeight}` } as CSSProperties)
                : undefined
            }
            className={`relative min-h-0 ${
              detail
                ? "aspect-(--stage-aspect,3/2) max-h-[60dvh] lg:aspect-auto lg:max-h-none lg:flex-1"
                : "flex-1"
            }`}
          >
            {detail ? (
              <img
                src={activeImageUrl}
                alt={detail.originalFilename}
                className="absolute inset-0 size-full object-contain"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-white/70">
                {loadFailed ? (
                  <p role="alert">This photo could not be loaded.</p>
                ) : (
                  <p role="status">Loading…</p>
                )}
              </div>
            )}
          </div>

          {detail && (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="text-xs text-white/70 tabular-nums">
                {activeWidth} × {activeHeight} px · {formatBytes(activeByteSize)}
              </span>
              <div className="flex items-center gap-2">
                <a
                  href={activeImageUrl}
                  download={detail.originalFilename}
                  className={STAGE_ACTION}
                >
                  <Download aria-hidden="true" />
                  Download {activeDevelopment ? activeDevelopment.format.toUpperCase() : "JPEG"}
                </a>
                {detail.hasRaw && detail.rawUrl && (
                  <a href={detail.rawUrl} className={STAGE_ACTION}>
                    <Download aria-hidden="true" />
                    RAW
                    {detail.rawByteSize != null && (
                      <span className="font-normal text-white/70 tabular-nums">
                        {formatBytes(detail.rawByteSize)}
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
            {detail && (
              <h2 className="min-w-0 py-1 text-sm font-semibold break-all text-ink">
                {detail.originalFilename}
              </h2>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              {detail && (
                <IconButton
                  aria-label="Favorite"
                  aria-pressed={detail.isFavorite}
                  onClick={handleToggleFavorite}
                >
                  <Star
                    aria-hidden="true"
                    className={detail.isFavorite ? "fill-star text-star" : ""}
                  />
                </IconButton>
              )}
              <IconButton aria-label="Close" onClick={onClose}>
                <X aria-hidden="true" />
              </IconButton>
            </div>
          </div>

          {detail && (
            <>
              <dl className="border-t border-line px-4 text-xs">
                <Field label="Captured">
                  {formatCaptureTime(detail.takenAt, detail.timezoneOffset)} (
                  {detail.timezoneOffset})
                </Field>
                <Field label="Camera">
                  {detail.cameraMake ?? "SONY"} {detail.cameraModel ?? "ILCE-7C"}
                </Field>
                <Field label="Lens">{detail.lensModel ?? EM_DASH}</Field>
                <Field label="Focal length">{withUnit(detail.focalLengthMm, " mm")}</Field>
                <Field label="Aperture">
                  {isRecorded(detail.fNumber) ? `f/${detail.fNumber}` : EM_DASH}
                </Field>
                <Field label="Shutter">{formatShutter(detail.exposureTime)}</Field>
                <Field label="ISO">{isRecorded(detail.iso) ? detail.iso : EM_DASH}</Field>
                <Field label="35mm equivalent">{withUnit(exif?.focalLength35mm, " mm")}</Field>
                <Field label="Exposure compensation">
                  {formatExposureCompensation(exif?.exposureCompensation)}
                </Field>
                <Field label="White balance">{exif?.whiteBalance || EM_DASH}</Field>
                <Field label="Metering">{exif?.meteringMode || EM_DASH}</Field>
              </dl>

              <section className="border-t border-line px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <SectionHeading count={detail.developments.length}>
                    Developed versions
                  </SectionHeading>
                  {detail.hasRaw && <span className="text-xs text-ink-faint">RAW stored</span>}
                </div>

                {detail.developments.length === 0 ? (
                  <p className="mt-1 text-xs text-ink-faint">
                    No developed versions yet. Upload them with{" "}
                    <code className="font-mono whitespace-nowrap text-ink-muted">
                      omoide sync-developed
                    </code>
                    .
                  </p>
                ) : (
                  <ul className="mt-1">
                    {detail.developments.map((dev) => {
                      const selected = selectedVariantId === dev.id;
                      return (
                        <li key={dev.id}>
                          <button
                            type="button"
                            aria-pressed={selected}
                            onClick={() => setSelectedVariantId(dev.id)}
                            className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-2 rounded-sm px-2 py-1 text-left text-xs transition-colors hover:bg-subtle"
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-ink">
                                {dev.format.toUpperCase()} · {dev.label}
                              </span>
                              <span className="block text-ink-muted tabular-nums">
                                {dev.width} × {dev.height} · {formatBytes(dev.byteSize)}
                              </span>
                            </span>
                            {selected && <span className="shrink-0 text-ink-faint">Viewing</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="border-t border-line px-4 py-3">
                <SectionHeading count={detail.posts.length}>Posts</SectionHeading>

                {detail.posts.length === 0 ? (
                  <p className="mt-1 text-xs text-ink-faint">Not posted anywhere yet.</p>
                ) : (
                  <ul className="mt-1">
                    {detail.posts.map((post) => (
                      <li key={post.id} className="flex items-center gap-2 py-1 text-xs">
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
                          {post.caption && (
                            <p className="mt-0.5 truncate text-ink-muted">{post.caption}</p>
                          )}
                        </div>
                        <IconButton
                          variant="danger-ghost"
                          size="sm"
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
      className={`h-6 shrink-0 rounded-sm px-2 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-offset-0 ${STAGE_FOCUS} ${
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
