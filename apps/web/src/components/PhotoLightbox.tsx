import type { ApiPhotoDetail, PhotoPostItem, SocialPlatform } from "@omoide/core";
import {
  Calendar,
  Camera,
  Download,
  ExternalLink,
  HardDrive,
  Layers,
  Plus,
  Share2,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

interface PhotoLightboxProps {
  photoId: string | null;
  onClose: () => void;
  onPhotoUpdated: (updated: ApiPhotoDetail) => void;
}

export function PhotoLightbox({ photoId, onClose, onPhotoUpdated }: PhotoLightboxProps) {
  const [detail, setDetail] = useState<ApiPhotoDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState<string>("original");
  const [newPlatform, setNewPlatform] = useState<SocialPlatform>("instagram");
  const [newPostUrl, setNewPostUrl] = useState("");
  const [newCaption, setNewCaption] = useState("");
  const [submittingPost, setSubmittingPost] = useState(false);

  useEffect(() => {
    if (!photoId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSelectedVariantId("original");

    fetch(`/api/v1/photos/${photoId}`)
      .then((res) => (res.ok ? (res.json() as Promise<ApiPhotoDetail>) : null))
      .then((data) => {
        if (!cancelled && data) {
          setDetail(data);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [photoId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (photoId) {
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }
  }, [photoId, onClose]);

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 md:p-6 backdrop-blur-xs"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        role="document"
        className="relative flex max-h-[92vh] w-full max-w-6xl flex-col lg:flex-row overflow-hidden rounded-xl border border-[#E4E4E7] bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* Left: Image Stage & Variant Tabs */}
        <div className="flex flex-1 flex-col justify-between bg-[#FAFAFA] p-4 md:p-6 min-h-[360px]">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E4E4E7]">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedVariantId("original")}
                className={`rounded-md px-2.5 py-1 font-mono-spec text-xs transition-colors ${
                  selectedVariantId === "original"
                    ? "bg-[#18181B] text-white"
                    : "border border-[#E4E4E7] bg-white text-[#3F3F46] hover:bg-[#F4F4F5]"
                }`}
              >
                Original JPEG
              </button>
              {detail?.developments.map((dev) => (
                <button
                  key={dev.id}
                  type="button"
                  onClick={() => setSelectedVariantId(dev.id)}
                  className={`rounded-md px-2.5 py-1 font-mono-spec text-xs uppercase transition-colors ${
                    selectedVariantId === dev.id
                      ? "bg-[#2563EB] text-white"
                      : "border border-[#E4E4E7] bg-white text-[#3F3F46] hover:bg-[#F4F4F5]"
                  }`}
                >
                  {dev.format} · {dev.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              {detail && (
                <button
                  type="button"
                  onClick={handleToggleFavorite}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                    detail.isFavorite
                      ? "border-amber-300 bg-amber-50 text-amber-800"
                      : "border-[#E4E4E7] bg-white text-[#3F3F46] hover:bg-[#F4F4F5]"
                  }`}
                >
                  <Star
                    className={`h-3.5 w-3.5 ${
                      detail.isFavorite ? "fill-amber-500 text-amber-500" : ""
                    }`}
                  />
                  {detail.isFavorite ? "Favorited (RAW Sync)" : "Favorite"}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-[#E4E4E7] bg-white p-1.5 text-[#71717A] hover:text-[#18181B]"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="my-4 flex flex-1 items-center justify-center overflow-hidden">
            {loading && !detail ? (
              <div className="font-mono-spec text-xs text-[#71717A]">
                Loading photo specification...
              </div>
            ) : detail ? (
              <img
                src={activeImageUrl}
                alt={detail.originalFilename}
                className="max-h-[62vh] w-auto max-w-full rounded-md border border-[#E4E4E7] object-contain bg-white shadow-xs"
              />
            ) : (
              <div className="font-mono-spec text-xs text-red-600">Photo could not be loaded.</div>
            )}
          </div>

          {detail && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[#E4E4E7] font-mono-spec text-xs text-[#71717A]">
              <span>
                {activeWidth} × {activeHeight} px · {formatBytes(activeByteSize)}
              </span>
              <div className="flex items-center gap-2">
                <a
                  href={activeImageUrl}
                  download={detail.originalFilename}
                  className="inline-flex items-center gap-1 rounded-md border border-[#E4E4E7] bg-white px-2.5 py-1 text-[#18181B] hover:bg-[#F4F4F5]"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download {activeDevelopment ? activeDevelopment.format.toUpperCase() : "JPEG"}
                </a>
                {detail.hasRaw && detail.rawUrl && (
                  <a
                    href={detail.rawUrl}
                    className="inline-flex items-center gap-1 rounded-md bg-[#18181B] px-2.5 py-1 text-white hover:bg-[#3F3F46]"
                  >
                    <HardDrive className="h-3.5 w-3.5" />
                    RAW .ARW {detail.rawByteSize ? `(${formatBytes(detail.rawByteSize)})` : ""}
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: Sony a7C EXIF Spec Sheet & 1:N Developments / Social Posts */}
        {detail && (
          <div className="w-full lg:w-96 overflow-y-auto border-t lg:border-t-0 lg:border-l border-[#E4E4E7] bg-white p-5 space-y-6">
            <div>
              <div className="flex items-center justify-between">
                <h2 className="font-mono-spec text-base font-semibold text-[#18181B]">
                  {detail.originalFilename}
                </h2>
                <span className="rounded bg-[#F4F4F5] px-2 py-0.5 font-mono-spec text-[11px] text-[#3F3F46]">
                  {detail.cameraModel ?? "ILCE-7C"}
                </span>
              </div>
              <p className="mt-1 font-mono-spec text-[11px] text-[#71717A] break-all">
                UUIDv7: {detail.id}
              </p>
            </div>

            {/* Core EXIF Grid */}
            <div className="space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#71717A]">
                <Camera className="h-3.5 w-3.5" />
                <span>EXIF Specification</span>
              </div>
              <div className="rounded-lg border border-[#E4E4E7] bg-[#FAFAFA] p-3 space-y-2 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="text-[#71717A]">Camera</span>
                  <span className="font-mono-spec text-[#18181B]">
                    {detail.cameraMake ?? "SONY"} {detail.cameraModel ?? "ILCE-7C"}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-[#71717A]">Lens</span>
                  <span className="font-mono-spec text-right text-[#18181B]">
                    {detail.lensModel ?? "—"}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 pt-2 border-t border-[#E4E4E7] text-center">
                  <div className="rounded bg-white p-1.5 border border-[#E4E4E7]">
                    <div className="text-[10px] text-[#71717A]">Focal</div>
                    <div className="font-mono-spec font-medium text-[#18181B]">
                      {detail.focalLengthMm ? `${detail.focalLengthMm}mm` : "—"}
                    </div>
                  </div>
                  <div className="rounded bg-white p-1.5 border border-[#E4E4E7]">
                    <div className="text-[10px] text-[#71717A]">Aperture</div>
                    <div className="font-mono-spec font-medium text-[#18181B]">
                      {detail.fNumber ? `f/${detail.fNumber}` : "—"}
                    </div>
                  </div>
                  <div className="rounded bg-white p-1.5 border border-[#E4E4E7]">
                    <div className="text-[10px] text-[#71717A]">Shutter</div>
                    <div className="font-mono-spec font-medium text-[#18181B]">
                      {detail.exposureTime ? `${detail.exposureTime}s` : "—"}
                    </div>
                  </div>
                  <div className="rounded bg-white p-1.5 border border-[#E4E4E7]">
                    <div className="text-[10px] text-[#71717A]">ISO</div>
                    <div className="font-mono-spec font-medium text-[#18181B]">
                      {detail.iso ?? "—"}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-[#E4E4E7]">
                  <span className="inline-flex items-center gap-1 text-[#71717A]">
                    <Calendar className="h-3 w-3" /> Captured
                  </span>
                  <span className="font-mono-spec text-[#18181B]">
                    {new Date(detail.takenAt).toLocaleString("ja-JP")} ({detail.timezoneOffset})
                  </span>
                </div>
                {detail.exifJson && (
                  <div className="pt-2 border-t border-[#E4E4E7] grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-[#71717A]">
                    {detail.exifJson.focalLength35mm && (
                      <div>35mm Eq: {detail.exifJson.focalLength35mm}mm</div>
                    )}
                    {detail.exifJson.exposureCompensation !== null && (
                      <div>
                        Exp Comp: {detail.exifJson.exposureCompensation > 0 ? "+" : ""}
                        {detail.exifJson.exposureCompensation} EV
                      </div>
                    )}
                    {detail.exifJson.whiteBalance && <div>WB: {detail.exifJson.whiteBalance}</div>}
                    {detail.exifJson.meteringMode && (
                      <div>Metering: {detail.exifJson.meteringMode}</div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 1:N Developed Variants */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-[#71717A]">
                <span className="inline-flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5" />
                  Developed Variants ({detail.developments.length})
                </span>
                {detail.hasRaw && (
                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono-spec text-[10px] text-emerald-700 border border-emerald-200">
                    1:1 .ARW Stored
                  </span>
                )}
              </div>

              {detail.developments.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[#E4E4E7] p-3 text-xs text-[#71717A]">
                  No developed exports attached yet. Use{" "}
                  <code className="font-mono-spec text-[#18181B]">omoide sync-developed</code> to
                  upload WebP, PNG, JPEG, or AVIF renders.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {detail.developments.map((dev) => (
                    <div
                      key={dev.id}
                      className="flex items-center justify-between rounded-md border border-[#E4E4E7] bg-[#FAFAFA] px-3 py-2 text-xs"
                    >
                      <div>
                        <span className="font-mono-spec font-semibold uppercase text-[#18181B]">
                          {dev.format}
                        </span>{" "}
                        <span className="text-[#71717A]">({dev.label})</span>
                        <div className="font-mono-spec text-[11px] text-[#71717A]">
                          {dev.width}×{dev.height} · {formatBytes(dev.byteSize)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedVariantId(dev.id)}
                        className="rounded border border-[#E4E4E7] bg-white px-2 py-1 font-mono-spec text-[11px] text-[#18181B] hover:bg-[#F4F4F5]"
                      >
                        Preview
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 1:N Social Media Posts */}
            <div className="space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#71717A]">
                <Share2 className="h-3.5 w-3.5" />
                <span>Published Destinations ({detail.posts.length})</span>
              </div>

              {detail.posts.length > 0 && (
                <div className="space-y-1.5">
                  {detail.posts.map((post) => (
                    <div
                      key={post.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-[#E4E4E7] bg-[#FAFAFA] px-3 py-2 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded bg-white px-1.5 py-0.5 font-mono-spec text-[10px] uppercase border border-[#E4E4E7] text-[#18181B]">
                            {post.platform}
                          </span>
                          <a
                            href={post.postUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 truncate font-mono-spec text-[11px] text-[#2563EB] hover:underline"
                          >
                            {post.postUrl}
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        </div>
                        {post.caption && (
                          <p className="mt-1 truncate text-[11px] text-[#71717A]">{post.caption}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeletePost(post.id)}
                        className="text-[#71717A] hover:text-red-600 p-1"
                        title="Remove post link"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <form
                onSubmit={handleAddPost}
                className="rounded-lg border border-[#E4E4E7] bg-[#FAFAFA] p-3 space-y-2"
              >
                <div className="text-[11px] font-medium text-[#3F3F46]">
                  Register Social / External Post
                </div>
                <div className="flex gap-2">
                  <select
                    value={newPlatform}
                    onChange={(e) => setNewPlatform(e.target.value as SocialPlatform)}
                    className="rounded-md border border-[#E4E4E7] bg-white px-2 py-1.5 text-xs text-[#18181B]"
                  >
                    <option value="instagram">Instagram</option>
                    <option value="twitter">Twitter / X</option>
                    <option value="blog">Blog</option>
                    <option value="portfolio">Portfolio</option>
                    <option value="other">Other</option>
                  </select>
                  <input
                    type="url"
                    required
                    placeholder="https://instagram.com/p/..."
                    value={newPostUrl}
                    onChange={(e) => setNewPostUrl(e.target.value)}
                    className="min-w-0 flex-1 rounded-md border border-[#E4E4E7] bg-white px-2.5 py-1.5 font-mono-spec text-xs text-[#18181B]"
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Optional note or caption"
                    value={newCaption}
                    onChange={(e) => setNewCaption(e.target.value)}
                    className="min-w-0 flex-1 rounded-md border border-[#E4E4E7] bg-white px-2.5 py-1.5 text-xs text-[#18181B]"
                  />
                  <button
                    type="submit"
                    disabled={submittingPost}
                    className="inline-flex items-center gap-1 rounded-md bg-[#18181B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#3F3F46] disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / 1024 ** i;
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
