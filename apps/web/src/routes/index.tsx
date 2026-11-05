import type {
  ApiPhotoDetail,
  ApiPhotoSummary,
  ListPhotosResponse,
  SocialPlatform,
} from "@omoide/core";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Calendar, RefreshCw, Search, Star, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDateFilter } from "~/components/app-sidebar";
import { PhotoHoverPreview, usePhotoHoverPreview } from "~/components/photo-hover-preview";
import { PhotoLightbox } from "~/components/photo-lightbox";
import { PhotoTable, PhotoTableSkeleton } from "~/components/photo-table";
import { Button, buttonClassName, IconButton } from "~/components/ui/button";
import { TextInput } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Separator } from "~/components/ui/separator";
import { SidebarTrigger } from "~/components/ui/sidebar";
import { usePhotoList } from "~/lib/use-photo-list";
import { usePhotoNavigation } from "~/lib/use-photo-navigation";

const PAGE_LIMIT = 100;
const NO_PHOTOS: ApiPhotoSummary[] = [];

export const Route = createFileRoute("/")({
  component: LibraryPage,
});

function formatCount(value: number) {
  return value.toLocaleString("en-US");
}

/**
 * Says how much of the list is loaded while more remains, and its size once it is complete. Reads
 * only the response, so the wording cannot change ahead of the numbers during a refetch.
 */
function formatListCount({ photos, matchedCount, nextCursor, facets }: ListPhotosResponse) {
  const noun = matchedCount === facets.totalCount ? "photos" : "matching";
  if (nextCursor === null) return `${formatCount(photos.length)} ${noun}`;
  return `${formatCount(photos.length)} of ${formatCount(Math.max(matchedCount, photos.length))} ${noun}`;
}

function LibraryPage() {
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);

  // Filter states
  const [search, setSearch] = useState("");
  const [lens, setLens] = useState("");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [onlyFavoriteDeveloped, setOnlyFavoriteDeveloped] = useState(false);
  const [onlyRaw, setOnlyRaw] = useState(false);
  const [onlyDeveloped, setOnlyDeveloped] = useState(false);
  const [platform, setPlatform] = useState<SocialPlatform | "">("");
  // Stays false through hydration, until the mount effect has read the filters from the URL.
  const [filtersReady, setFiltersReady] = useState(false);

  const { month, date, setMonth, setDate, clearDateFilter, setTimelineFacets } = useDateFilter();

  const { target: previewTarget, controls: preview } = usePhotoHoverPreview(
    selectedPhotoId !== null,
  );
  const hidePreview = preview.hide;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Read initial URL search params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("favorite") === "true") setOnlyFavorites(true);
    if (params.get("hasFavoriteDevelopment") === "true") setOnlyFavoriteDeveloped(true);
    if (params.get("hasDeveloped") === "true") setOnlyDeveloped(true);
    if (params.get("hasRaw") === "true") setOnlyRaw(true);
    if (params.get("lens")) setLens(params.get("lens") ?? "");
    if (params.get("month")) setMonth(params.get("month") ?? "");
    if (params.get("date")) setDate(params.get("date") ?? "");
    setFiltersReady(true);
  }, [setMonth, setDate]);

  const query = useMemo(() => {
    if (!filtersReady) return null;
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (lens) params.set("lens", lens);
    if (month) params.set("month", month);
    if (date) params.set("date", date);
    if (onlyFavorites) params.set("favorite", "true");
    if (onlyFavoriteDeveloped) params.set("hasFavoriteDevelopment", "true");
    if (onlyRaw) params.set("hasRaw", "true");
    if (onlyDeveloped) params.set("hasDeveloped", "true");
    if (platform) params.set("platform", platform);
    params.set("limit", String(PAGE_LIMIT));
    return params.toString();
  }, [
    filtersReady,
    search,
    lens,
    month,
    date,
    onlyFavorites,
    onlyFavoriteDeveloped,
    onlyRaw,
    onlyDeveloped,
    platform,
  ]);

  const handleListReset = useCallback(() => {
    scrollContainerRef.current?.scrollTo({ top: 0 });
    // Replacing the rows fires no pointerleave for a resting pointer.
    hidePreview();
  }, [hidePreview]);

  const {
    data,
    loading,
    loadingMore,
    loadError,
    nextPageFailed,
    canLoadMore,
    refresh,
    loadNextPage,
    updatePhoto,
  } = usePhotoList({ query, onReset: handleListReset });

  useEffect(() => {
    if (data?.facets) {
      setTimelineFacets(data.facets.months, data.facets.totalCount);
    }
  }, [data?.facets, setTimelineFacets]);

  const handleToggleFavorite = useCallback(
    async (photo: ApiPhotoSummary) => {
      const res = await fetch(`/api/v1/photos/${photo.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isFavorite: !photo.isFavorite }),
      });
      if (res.ok) updatePhoto((await res.json()) as ApiPhotoDetail);
    },
    [updatePhoto],
  );

  /** The row reached with previous and next, which isn't the one that had the focus at opening. */
  const steppedRef = useRef(false);
  const handleNavigate = useCallback((photoId: string) => {
    steppedRef.current = true;
    setSelectedPhotoId(photoId);
  }, []);
  const handleCloseDetail = useCallback(() => setSelectedPhotoId(null), []);

  // Opening with a click on a cell leaves nothing focused to go back to, either.
  const lastViewedRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedPhotoId !== null) {
      lastViewedRef.current = selectedPhotoId;
      return;
    }
    const lastViewed = lastViewedRef.current;
    if (lastViewed === null) return;
    const stepped = steppedRef.current;
    lastViewedRef.current = null;
    steppedRef.current = false;
    if (!stepped && document.activeElement !== document.body) return;
    scrollContainerRef.current
      ?.querySelector<HTMLElement>(
        `tr[data-photo-id="${CSS.escape(lastViewed)}"] [data-photo-open]`,
      )
      ?.focus({ preventScroll: true });
  }, [selectedPhotoId]);

  function resetFilters() {
    setSearch("");
    setLens("");
    clearDateFilter();
    setOnlyFavorites(false);
    setOnlyFavoriteDeveloped(false);
    setOnlyRaw(false);
    setOnlyDeveloped(false);
    setPlatform("");
  }

  const facets = data?.facets;
  const photos = data?.photos ?? NO_PHOTOS;
  const navigation = usePhotoNavigation({
    photos,
    selectedId: selectedPhotoId,
    onNavigate: handleNavigate,
    hasMore: (data?.nextCursor ?? null) !== null,
    canLoadMore,
    loadingMore,
    loadMoreFailed: nextPageFailed,
    loadMore: loadNextPage,
  });
  const hasFilters = Boolean(
    search ||
      lens ||
      month ||
      date ||
      onlyFavorites ||
      onlyFavoriteDeveloped ||
      onlyRaw ||
      onlyDeveloped ||
      platform,
  );
  const activeTimelineLabel = date || month;

  function renderContent() {
    if (loadError === "unauthorized") {
      return (
        <Notice role="alert">
          <p className="text-ink">Sign in to view your library</p>
          <Link to="/settings" className={buttonClassName("primary")}>
            Open settings
          </Link>
        </Notice>
      );
    }
    if (loadError === "failed") {
      return (
        <Notice role="alert">
          <p className="text-ink">Your photos could not be loaded.</p>
          <Button onClick={() => void refresh()} disabled={loading}>
            Retry
          </Button>
        </Notice>
      );
    }
    if (!data) return <PhotoTableSkeleton />;
    if (photos.length === 0) {
      // Reads the response, because the filters change ahead of the rows during a refetch.
      return data.facets.totalCount === 0 ? (
        <Notice>
          <p className="text-ink">No photos yet. Upload them with the CLI:</p>
          <code className="rounded-sm bg-subtle px-2 py-1 font-mono text-xs break-all text-ink">
            pnpm --filter @omoide/cli dev sync
          </code>
        </Notice>
      ) : (
        <Notice>
          <p className="text-ink">No photos match these filters.</p>
          <Button onClick={resetFilters}>Clear filters</Button>
        </Notice>
      );
    }
    return (
      <PhotoTable
        photos={photos}
        matchedCount={data.matchedCount}
        selectedPhotoId={selectedPhotoId}
        busy={loading || loadingMore}
        scrollContainerRef={scrollContainerRef}
        canLoadMore={canLoadMore}
        loadingMore={loadingMore}
        loadMoreFailed={nextPageFailed}
        onLoadMore={loadNextPage}
        preview={preview}
        onOpen={setSelectedPhotoId}
        onToggleFavorite={handleToggleFavorite}
      />
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-surface">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="my-auto h-4" />

        <div className="relative min-w-40 flex-1 sm:w-48 sm:flex-none 2xl:w-64">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-faint"
          />
          <TextInput
            ref={searchInputRef}
            type="search"
            aria-label="Search photos"
            placeholder="Search photos"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pr-8 pl-8 [&::-webkit-search-cancel-button]:appearance-none"
          />
          {search && (
            <IconButton
              size="sm"
              aria-label="Clear search"
              onClick={() => {
                setSearch("");
                searchInputRef.current?.focus();
              }}
              className="absolute top-1/2 right-0.5 -translate-y-1/2"
            >
              <X aria-hidden="true" />
            </IconButton>
          )}
        </div>

        <Select
          aria-label="Lens"
          value={lens}
          onChange={(e) => setLens(e.target.value)}
          className="min-w-0 grow basis-[calc((100%-1rem)/2)] sm:w-40 sm:grow-0 sm:basis-auto 2xl:w-52"
        >
          <option value="">Lens</option>
          {facets?.lenses.map((l) => (
            <option key={l.lensModel} value={l.lensModel}>
              {l.lensModel} ({formatCount(l.count)})
            </option>
          ))}
        </Select>

        <Select
          aria-label="Platform"
          value={platform}
          onChange={(e) => setPlatform(e.target.value as SocialPlatform | "")}
          className="min-w-0 grow basis-[calc((100%-1rem)/2)] sm:w-36 sm:grow-0 sm:basis-auto"
        >
          <option value="">Platform</option>
          <option value="instagram">Instagram</option>
          <option value="twitter">Twitter / X</option>
          <option value="blog">Blog</option>
          <option value="portfolio">Portfolio</option>
        </Select>

        <FilterToggle
          label="Favorites"
          count={facets?.favoriteCount}
          pressed={onlyFavorites}
          onToggle={() => setOnlyFavorites((v) => !v)}
          icon={<Star aria-hidden="true" className={onlyFavorites ? "fill-star text-star" : ""} />}
        />
        <FilterToggle
          label="Dev Favorites"
          count={facets?.favoriteDevelopedCount}
          pressed={onlyFavoriteDeveloped}
          onToggle={() => setOnlyFavoriteDeveloped((v) => !v)}
          icon={
            <Star
              aria-hidden="true"
              className={onlyFavoriteDeveloped ? "fill-star text-star" : ""}
            />
          }
        />
        <FilterToggle
          label="RAW"
          count={facets?.rawCount}
          pressed={onlyRaw}
          onToggle={() => setOnlyRaw((v) => !v)}
        />
        <FilterToggle
          label="Developed"
          count={facets?.developedCount}
          pressed={onlyDeveloped}
          onToggle={() => setOnlyDeveloped((v) => !v)}
        />

        {activeTimelineLabel && (
          <Button
            onClick={clearDateFilter}
            aria-label={`Clear date filter ${activeTimelineLabel}`}
            className="border-accent/40 bg-accent/10 font-mono text-xs text-accent hover:bg-accent/15"
          >
            <Calendar aria-hidden="true" className="size-3.5" />
            {activeTimelineLabel}
            <X aria-hidden="true" className="size-3.5" />
          </Button>
        )}

        {hasFilters && (
          <Button variant="ghost" onClick={resetFilters}>
            Clear
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <IconButton aria-label="Refresh" title="Refresh" onClick={() => void refresh()}>
            <RefreshCw aria-hidden="true" className={loading ? "animate-spin" : ""} />
          </IconButton>
          {/* Always rendered with a floor on its width, so the toolbar holds still as it counts. */}
          <p
            aria-live="polite"
            className="min-w-36 text-right text-xs whitespace-nowrap text-ink-faint tabular-nums"
          >
            {data && !loadError && formatListCount(data)}
          </p>
        </div>
      </div>

      {/*
        The scroll padding keeps keyboard-focused rows clear of the sticky header. `relative` makes
        this the containing block for the rows' sr-only text, which would otherwise extend the
        document and make the window scroll. Scroll anchoring is off because the virtualized rows
        already keep their positions through the spacer rows.
      */}
      <div
        ref={scrollContainerRef}
        data-preview-bounds
        className="relative min-h-0 flex-1 scroll-pt-8 overflow-auto [overflow-anchor:none]"
      >
        {renderContent()}
      </div>

      <PhotoHoverPreview target={previewTarget} />
      <PhotoLightbox
        photoId={selectedPhotoId}
        summary={photos[navigation.index]}
        position={navigation.index + 1}
        total={Math.max(data?.matchedCount ?? 0, photos.length)}
        hasPrevious={navigation.hasPrevious}
        hasNext={navigation.hasNext}
        waitingForNext={navigation.waitingForNext}
        nextFailed={navigation.nextFailed}
        onPrevious={navigation.goPrevious}
        onNext={navigation.goNext}
        onClose={handleCloseDetail}
        onPhotoUpdated={updatePhoto}
      />
    </main>
  );
}

interface FilterToggleProps {
  label: string;
  count: number | undefined;
  pressed: boolean;
  onToggle: () => void;
  icon?: ReactNode;
}

function FilterToggle({ label, count, pressed, onToggle, icon }: FilterToggleProps) {
  return (
    <Button
      aria-pressed={pressed}
      onClick={onToggle}
      className="aria-pressed:border-accent/40 aria-pressed:bg-accent/10 aria-pressed:text-accent"
    >
      {icon}
      {label}
      {count !== undefined && (
        <span className={`font-normal tabular-nums ${pressed ? "" : "text-ink-faint"}`}>
          {formatCount(count)}
        </span>
      )}
    </Button>
  );
}

function Notice({ role, children }: { role?: "alert"; children: ReactNode }) {
  return (
    <div role={role} className="flex flex-col items-center gap-3 px-4 py-16 text-center">
      {children}
    </div>
  );
}
