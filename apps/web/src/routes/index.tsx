import type {
  ApiPhotoDetail,
  ApiPhotoSummary,
  ListPhotosResponse,
  SocialPlatform,
} from "@omoide/core";
import { createFileRoute } from "@tanstack/react-router";
import { Camera, Filter, HardDrive, Layers, RefreshCw, Search, Share2, Star } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { BlurhashImage } from "~/components/BlurhashImage";
import { PhotoLightbox } from "~/components/PhotoLightbox";

export const Route = createFileRoute("/")({
  component: GalleryPage,
});

function GalleryPage() {
  const [data, setData] = useState<ListPhotosResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);

  // Filter states
  const [search, setSearch] = useState("");
  const [lens, setLens] = useState("");
  const [month, setMonth] = useState("");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [onlyRaw, setOnlyRaw] = useState(false);
  const [onlyDeveloped, setOnlyDeveloped] = useState(false);
  const [platform, setPlatform] = useState<SocialPlatform | "">("");

  // Read initial URL search params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("favorite") === "true") setOnlyFavorites(true);
    if (params.get("hasDeveloped") === "true") setOnlyDeveloped(true);
    if (params.get("hasRaw") === "true") setOnlyRaw(true);
    if (params.get("lens")) setLens(params.get("lens") ?? "");
  }, []);

  const fetchPhotos = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (lens) params.set("lens", lens);
      if (month) params.set("month", month);
      if (onlyFavorites) params.set("favorite", "true");
      if (onlyRaw) params.set("hasRaw", "true");
      if (onlyDeveloped) params.set("hasDeveloped", "true");
      if (platform) params.set("platform", platform);
      params.set("limit", "120");

      const res = await fetch(`/api/v1/photos?${params.toString()}`);
      if (res.ok) {
        const json = (await res.json()) as ListPhotosResponse;
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }, [search, lens, month, onlyFavorites, onlyRaw, onlyDeveloped, platform]);

  useEffect(() => {
    void fetchPhotos();
  }, [fetchPhotos]);

  async function handleQuickToggleFavorite(e: React.MouseEvent, photo: ApiPhotoSummary) {
    e.stopPropagation();
    const res = await fetch(`/api/v1/photos/${photo.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isFavorite: !photo.isFavorite }),
    });
    if (res.ok) {
      const updated = (await res.json()) as ApiPhotoDetail;
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          photos: prev.photos.map((p) => (p.id === updated.id ? updated : p)),
          facets: {
            ...prev.facets,
            favoriteCount: prev.facets.favoriteCount + (updated.isFavorite ? 1 : -1),
          },
        };
      });
    }
  }

  function handlePhotoUpdated(updated: ApiPhotoDetail) {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        photos: prev.photos.map((p) => (p.id === updated.id ? updated : p)),
      };
    });
  }

  function resetFilters() {
    setSearch("");
    setLens("");
    setMonth("");
    setOnlyFavorites(false);
    setOnlyRaw(false);
    setOnlyDeveloped(false);
    setPlatform("");
  }

  const facets = data?.facets;
  const photos = data?.photos ?? [];

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 md:py-12">
      {/* Header Section (clean minimal aesthetic) */}
      <header className="flex flex-col gap-6 border-b border-[#E4E4E7] pb-8 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#E4E4E7] bg-[#FAFAFA] px-3 py-1 font-mono-spec text-xs text-[#3F3F46]">
            <Camera className="h-3.5 w-3.5 text-[#18181B]" />
            <span>PHOTOGRAPHY ARCHIVE</span>
          </div>
          <h1 className="font-display-mono text-2xl font-semibold tracking-tight text-[#18181B] sm:text-3xl">
            Omoide Photo Index
          </h1>
          <p className="max-w-xl text-sm text-[#71717A]">
            Deterministic UUIDv7 capture index, 1:1 JPEG &amp; .ARW RAW storage, 1:N developed
            variants, and published social destinations.
          </p>
        </div>

        {/* Stat Pills */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div className="rounded-lg border border-[#E4E4E7] bg-[#FAFAFA] px-3.5 py-2.5">
            <div className="text-[11px] text-[#71717A]">Total JPEGs</div>
            <div className="font-mono-spec text-lg font-semibold text-[#18181B]">
              {facets?.totalCount ?? 0}
            </div>
          </div>
          <div className="rounded-lg border border-[#E4E4E7] bg-[#FAFAFA] px-3.5 py-2.5">
            <div className="text-[11px] text-[#71717A]">Favorites ★</div>
            <div className="font-mono-spec text-lg font-semibold text-[#18181B]">
              {facets?.favoriteCount ?? 0}
            </div>
          </div>
          <div className="rounded-lg border border-[#E4E4E7] bg-[#FAFAFA] px-3.5 py-2.5">
            <div className="text-[11px] text-[#71717A]">1:1 RAW (.ARW)</div>
            <div className="font-mono-spec text-lg font-semibold text-[#18181B]">
              {facets?.rawCount ?? 0}
            </div>
          </div>
          <div className="rounded-lg border border-[#E4E4E7] bg-[#FAFAFA] px-3.5 py-2.5">
            <div className="text-[11px] text-[#71717A]">Developed</div>
            <div className="font-mono-spec text-lg font-semibold text-[#18181B]">
              {facets?.developedCount ?? 0}
            </div>
          </div>
        </div>
      </header>

      {/* Filter Bar */}
      <section className="my-6 space-y-3 rounded-xl border border-[#E4E4E7] bg-[#FAFAFA] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-[#71717A]" />
            <input
              type="search"
              placeholder="Search DSC filename, lens, or UUIDv7..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-[#E4E4E7] bg-white py-1.5 pr-3 pl-9 font-mono-spec text-xs text-[#18181B] placeholder:text-[#71717A] focus:border-[#18181B] focus:outline-none"
            />
          </div>

          <select
            value={lens}
            onChange={(e) => setLens(e.target.value)}
            className="rounded-lg border border-[#E4E4E7] bg-white px-3 py-1.5 font-mono-spec text-xs text-[#18181B]"
          >
            <option value="">All Lenses</option>
            {facets?.lenses.map((l) => (
              <option key={l.lensModel} value={l.lensModel}>
                {l.lensModel} ({l.count})
              </option>
            ))}
          </select>

          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-[#E4E4E7] bg-white px-3 py-1.5 font-mono-spec text-xs text-[#18181B]"
          >
            <option value="">All Months</option>
            {facets?.months.map((m) => (
              <option key={m.month} value={m.month}>
                {m.month} ({m.count})
              </option>
            ))}
          </select>

          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as SocialPlatform | "")}
            className="rounded-lg border border-[#E4E4E7] bg-white px-3 py-1.5 font-mono-spec text-xs text-[#18181B]"
          >
            <option value="">All Platforms</option>
            <option value="instagram">Instagram</option>
            <option value="twitter">Twitter / X</option>
            <option value="blog">Blog</option>
            <option value="portfolio">Portfolio</option>
          </select>

          <button
            type="button"
            onClick={() => void fetchPhotos()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E4E4E7] bg-white px-3 py-1.5 text-xs font-medium text-[#3F3F46] hover:bg-[#F4F4F5]"
            title="Refresh gallery"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#E4E4E7]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs text-[#71717A]">
              <Filter className="h-3.5 w-3.5" /> Filter:
            </span>
            <button
              type="button"
              onClick={() => setOnlyFavorites((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                onlyFavorites
                  ? "border-amber-400 bg-amber-50 text-amber-900"
                  : "border-[#E4E4E7] bg-white text-[#3F3F46] hover:bg-[#F4F4F5]"
              }`}
            >
              <Star className={`h-3 w-3 ${onlyFavorites ? "fill-amber-500 text-amber-500" : ""}`} />
              Favorites Only
            </button>

            <button
              type="button"
              onClick={() => setOnlyRaw((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                onlyRaw
                  ? "border-[#18181B] bg-[#18181B] text-white"
                  : "border-[#E4E4E7] bg-white text-[#3F3F46] hover:bg-[#F4F4F5]"
              }`}
            >
              <HardDrive className="h-3 w-3" />
              Has .ARW RAW
            </button>

            <button
              type="button"
              onClick={() => setOnlyDeveloped((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                onlyDeveloped
                  ? "border-[#2563EB] bg-[#2563EB] text-white"
                  : "border-[#E4E4E7] bg-white text-[#3F3F46] hover:bg-[#F4F4F5]"
              }`}
            >
              <Layers className="h-3 w-3" />
              Has Developed (WebP/PNG/AVIF)
            </button>
          </div>

          {(search || lens || month || onlyFavorites || onlyRaw || onlyDeveloped || platform) && (
            <button
              type="button"
              onClick={resetFilters}
              className="font-mono-spec text-xs text-[#2563EB] hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </section>

      {/* Gallery Grid */}
      {loading && !data ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {["s1", "s2", "s3", "s4", "s5", "s6"].map((skeletonId) => (
            <div
              key={skeletonId}
              className="aspect-[3/2] animate-pulse rounded-xl border border-[#E4E4E7] bg-[#F4F4F5]"
            />
          ))}
        </div>
      ) : photos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#E4E4E7] bg-[#FAFAFA] p-12 text-center space-y-3">
          <Camera className="mx-auto h-8 w-8 text-[#71717A]" />
          <h2 className="font-display-mono text-base font-semibold text-[#18181B]">
            No photos match the current view
          </h2>
          <p className="mx-auto max-w-md text-xs text-[#71717A]">
            Upload photos from your desktop (`F:\DCIM` or session folders) using the CLI:
          </p>
          <pre className="mx-auto max-w-lg overflow-x-auto rounded-lg border border-[#E4E4E7] bg-white p-3 text-left font-mono-spec text-xs text-[#18181B]">
            pnpm --filter @omoide/cli dev sync
          </pre>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((photo) => (
            <article
              key={photo.id}
              onClick={() => setSelectedPhotoId(photo.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedPhotoId(photo.id);
                }
              }}
              className="group cursor-pointer overflow-hidden rounded-xl border border-[#E4E4E7] bg-white transition-all hover:border-[#18181B] hover:shadow-sm"
            >
              <div className="relative">
                <BlurhashImage
                  src={photo.thumbUrl ?? photo.jpegUrl}
                  alt={photo.originalFilename}
                  blurhash={photo.blurhash}
                  width={photo.width}
                  height={photo.height}
                />

                {/* Top Overlay Badges */}
                <div className="absolute top-2.5 right-2.5 left-2.5 flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1">
                    {photo.hasRaw && (
                      <span className="rounded bg-[#18181B]/85 px-1.5 py-0.5 font-mono-spec text-[10px] font-medium text-white backdrop-blur-xs">
                        RAW
                      </span>
                    )}
                    {photo.developmentsCount > 0 && (
                      <span className="rounded bg-[#2563EB]/90 px-1.5 py-0.5 font-mono-spec text-[10px] font-medium text-white backdrop-blur-xs">
                        DEV ×{photo.developmentsCount}
                      </span>
                    )}
                    {photo.platforms.map((plat) => (
                      <span
                        key={plat}
                        className="inline-flex items-center gap-0.5 rounded bg-white/90 px-1.5 py-0.5 font-mono-spec text-[10px] uppercase text-[#18181B] border border-[#E4E4E7] backdrop-blur-xs"
                      >
                        <Share2 className="h-2.5 w-2.5" />
                        {plat === "instagram" ? "IG" : plat === "twitter" ? "X" : plat}
                      </span>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={(e) => void handleQuickToggleFavorite(e, photo)}
                    className={`flex h-7 w-7 items-center justify-center rounded-full border backdrop-blur-xs transition-colors ${
                      photo.isFavorite
                        ? "border-amber-300 bg-amber-50/95 text-amber-500"
                        : "border-white/50 bg-white/80 text-[#71717A] hover:text-[#18181B]"
                    }`}
                    title={
                      photo.isFavorite ? "Favorited (marked for RAW sync)" : "Mark as favorite"
                    }
                  >
                    <Star className={`h-3.5 w-3.5 ${photo.isFavorite ? "fill-amber-500" : ""}`} />
                  </button>
                </div>
              </div>

              {/* Card Metadata Footer */}
              <div className="p-3.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono-spec text-xs font-semibold text-[#18181B]">
                    {photo.originalFilename}
                  </span>
                  <span className="font-mono-spec text-[11px] text-[#71717A]">
                    {new Date(photo.takenAt).toLocaleDateString("ja-JP")}
                  </span>
                </div>

                <div className="truncate font-mono-spec text-[11px] text-[#71717A]">
                  {photo.lensModel ?? "SONY ILCE-7C"}
                </div>

                <div className="flex items-center gap-2 pt-1 font-mono-spec text-[11px] text-[#3F3F46]">
                  {photo.focalLengthMm && <span>{photo.focalLengthMm}mm</span>}
                  {photo.fNumber && <span>f/{photo.fNumber}</span>}
                  {photo.exposureTime && <span>{photo.exposureTime}s</span>}
                  {photo.iso && <span>ISO {photo.iso}</span>}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <PhotoLightbox
        photoId={selectedPhotoId}
        onClose={() => setSelectedPhotoId(null)}
        onPhotoUpdated={handlePhotoUpdated}
      />
    </main>
  );
}
