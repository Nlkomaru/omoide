import type { ApiPhotoSummary, SocialPlatform } from "@omoide/core";
import {
  createColumnHelper,
  FlexRender,
  type Row,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  BriefcaseBusiness,
  Check,
  Instagram,
  Link as LinkIcon,
  type LucideIcon,
  Newspaper,
  Star,
  Twitter,
} from "lucide-react";
import { memo, type ReactNode, type RefObject, useEffect, useRef } from "react";
import { BlurhashImage } from "~/components/blurhash-image";
import type { PhotoPreviewControls } from "~/components/photo-hover-preview";
import { Button, IconButton } from "~/components/ui/button";
import { formatBytes, formatCaptureTime, isRecorded } from "~/lib/format";

const EM_DASH = "—";

const NUMERIC = "px-2 text-right tabular-nums whitespace-nowrap";

const MUTED = "text-ink-muted";

/** Matches `h-8` on the header cells and `h-10` on the body cells. */
const HEADER_HEIGHT_PX = 32;
const ROW_HEIGHT_PX = 40;

/** Keeps the next rows mounted, so Tab has somewhere to go before the scroll catches up. */
const OVERSCAN_ROWS = 12;

/** The next page starts loading once the rendered rows come this close to the end. */
const LOAD_MORE_THRESHOLD_ROWS = 20;

interface ColumnLayout {
  label: string;
  labelHidden?: boolean;
  width: string;
  /** Visibility, spacing and alignment shared by the header and body cells. */
  className: string;
  bodyClassName?: string;
  title?: (photo: ApiPhotoSummary) => string | undefined;
  /** Marks the cell the hover preview opens beside. */
  previewStart?: boolean;
}

function takenLabel(photo: ApiPhotoSummary) {
  return formatCaptureTime(photo.takenAt, photo.timezoneOffset).slice(0, 16);
}

function postedLabel(photo: ApiPhotoSummary) {
  return photo.postLinks.map((post) => `${PLATFORM_LABELS[post.platform]}: ${post.url}`).join(", ");
}

const COLUMN = {
  thumb: { label: "Preview", labelHidden: true, width: "w-16", className: "pr-2 pl-3" },
  star: { label: "Favorite", labelHidden: true, width: "w-8", className: "px-0.5" },
  // No width below lg: the file column takes the slack until the lens column appears. From 2xl
  // it shares the slack with lens, which holds the shorter values.
  file: { label: "File", width: "lg:w-76 2xl:w-[24%]", className: "px-2 text-left" },
  taken: {
    label: "Taken",
    width: "w-34",
    className: "pr-3 pl-2 text-left font-mono text-xs tabular-nums md:pr-2",
    bodyClassName: `whitespace-nowrap ${MUTED}`,
    title: (photo) => `${takenLabel(photo)} (${photo.timezoneOffset})`,
  },
  lens: {
    label: "Lens",
    width: "",
    className: "hidden px-2 text-left lg:table-cell",
    bodyClassName: `truncate ${MUTED}`,
    title: (photo) => photo.lensModel ?? undefined,
    previewStart: true,
  },
  focal: {
    label: "Focal",
    width: "w-16",
    className: `hidden md:table-cell ${NUMERIC}`,
    bodyClassName: MUTED,
  },
  aperture: {
    label: "Aperture",
    width: "w-17",
    className: `hidden md:table-cell ${NUMERIC}`,
    bodyClassName: MUTED,
  },
  shutter: {
    label: "Shutter",
    width: "w-18",
    className: `hidden md:table-cell ${NUMERIC}`,
    bodyClassName: MUTED,
  },
  iso: {
    label: "ISO",
    width: "w-14",
    className: "hidden pr-3 pl-2 text-right tabular-nums whitespace-nowrap md:table-cell xl:pr-2",
    bodyClassName: MUTED,
  },
  size: {
    label: "Size",
    width: "w-28",
    className: `hidden 2xl:table-cell ${NUMERIC}`,
    bodyClassName: MUTED,
  },
  fileSize: {
    label: "File size",
    width: "w-20",
    className: `hidden 2xl:table-cell ${NUMERIC}`,
    bodyClassName: MUTED,
  },
  raw: {
    label: "RAW",
    width: "w-11",
    className: "hidden px-2 text-center xl:table-cell",
    bodyClassName: MUTED,
  },
  developed: {
    label: "Developed",
    width: "w-22",
    className: `hidden xl:table-cell ${NUMERIC}`,
    bodyClassName: MUTED,
    title: (photo) =>
      photo.developmentsCount > 0
        ? photo.favoriteDevelopmentsCount > 0
          ? `${photo.developmentsCount} developed (${photo.favoriteDevelopmentsCount} favorite)`
          : `${photo.developmentsCount} developed`
        : undefined,
  },
  posted: {
    label: "Posted",
    width: "w-24",
    className: "hidden pr-3 pl-3 text-left xl:table-cell",
    bodyClassName: `truncate ${MUTED}`,
    title: (photo) => postedLabel(photo) || undefined,
  },
} satisfies Record<string, ColumnLayout>;

type ColumnKey = keyof typeof COLUMN;

const COLUMN_KEYS = Object.keys(COLUMN) as ColumnKey[];

function columnLayout(columnId: string): ColumnLayout {
  return COLUMN[columnId as ColumnKey];
}

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  twitter: "Twitter / X",
  blog: "Blog",
  portfolio: "Portfolio",
  other: "Other",
};

const PLATFORM_ICONS: Record<SocialPlatform, LucideIcon> = {
  instagram: Instagram,
  twitter: Twitter,
  blog: Newspaper,
  portfolio: BriefcaseBusiness,
  other: LinkIcon,
};

const ROW_CELLS = "[&>td]:h-10 [&>td]:border-b [&>td]:border-line";

const SKELETON_ROWS = Array.from({ length: 16 }, (_, row) => row);

/** Covers `.jpg` plus eight characters, the part of a renamed UUIDv7 file that differs most. */
const FILENAME_TAIL_LENGTH = 12;

function Dash() {
  return <span className="text-ink-faint">{EM_DASH}</span>;
}

/** Ellipsizes the middle of a long filename, so its end stays readable. */
function Filename({ name }: { name: string }) {
  return (
    <>
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre">
        {name.slice(0, -FILENAME_TAIL_LENGTH)}
      </span>
      <span className="shrink-0 whitespace-pre">{name.slice(-FILENAME_TAIL_LENGTH)}</span>
    </>
  );
}

/** Handlers the cells read from the table, so the column definitions can stay at module scope. */
interface PhotoRowActions {
  preview: PhotoPreviewControls;
  onOpen: (photoId: string) => void;
  onToggleFavorite: (photo: ApiPhotoSummary) => void;
}

const features = tableFeatures({ tableMeta: {} as PhotoRowActions });

const columnHelper = createColumnHelper<typeof features, ApiPhotoSummary>();

function photoColumn(
  id: ColumnKey,
  render: (photo: ApiPhotoSummary, actions: PhotoRowActions) => ReactNode,
) {
  return columnHelper.display({
    id,
    header: COLUMN[id].label,
    cell: ({ row, table }) => render(row.original, table.options.meta as PhotoRowActions),
  });
}

const PHOTO_COLUMNS = columnHelper.columns([
  photoColumn("thumb", (photo, { preview, onOpen }) => (
    <button
      type="button"
      aria-label={`Open ${photo.originalFilename}`}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") preview.schedule(photo, e.currentTarget, "pointer");
      }}
      onPointerLeave={preview.leave}
      onFocus={(e) => {
        if (e.currentTarget.matches(":focus-visible")) {
          preview.schedule(photo, e.currentTarget, "focus");
        }
      }}
      onBlur={preview.hide}
      onClick={() => {
        preview.hide();
        onOpen(photo.id);
      }}
      className="block h-8 w-12 cursor-pointer rounded-sm"
    >
      <BlurhashImage
        src={photo.thumbUrl ?? photo.jpegUrl}
        alt=""
        blurhash={photo.blurhash}
        width={photo.width}
        height={photo.height}
        className="h-8 w-12 rounded-sm"
      />
    </button>
  )),
  photoColumn("star", (photo, { onToggleFavorite }) => (
    <IconButton
      size="sm"
      aria-label={`Favorite ${photo.originalFilename}`}
      aria-pressed={photo.isFavorite}
      onClick={(e) => {
        e.stopPropagation();
        onToggleFavorite(photo);
      }}
      className="cursor-pointer"
    >
      <Star
        aria-hidden="true"
        className={
          photo.isFavorite ? "fill-star text-star" : "text-ink-faint group-hover:text-ink-muted"
        }
      />
    </IconButton>
  )),
  photoColumn("file", (photo, { onOpen }) => (
    <button
      type="button"
      title={photo.originalFilename}
      data-photo-open
      onClick={() => onOpen(photo.id)}
      className="flex max-w-full cursor-pointer rounded-sm text-left font-mono text-xs font-medium text-ink"
    >
      <Filename name={photo.originalFilename} />
    </button>
  )),
  photoColumn("taken", takenLabel),
  photoColumn("lens", (photo) => photo.lensModel ?? <Dash />),
  photoColumn("focal", (photo) =>
    isRecorded(photo.focalLengthMm) ? `${photo.focalLengthMm} mm` : <Dash />,
  ),
  photoColumn("aperture", (photo) => (isRecorded(photo.fNumber) ? `f/${photo.fNumber}` : <Dash />)),
  photoColumn("shutter", (photo) =>
    photo.exposureTime ? (
      `${photo.exposureTime}${photo.exposureTime.endsWith("s") ? "" : "s"}`
    ) : (
      <Dash />
    ),
  ),
  photoColumn("iso", (photo) => (isRecorded(photo.iso) ? photo.iso : <Dash />)),
  photoColumn("size", (photo) => `${photo.width} × ${photo.height}`),
  photoColumn("fileSize", (photo) => formatBytes(photo.jpegByteSize)),
  photoColumn("raw", (photo) =>
    photo.hasRaw ? (
      <>
        <Check aria-hidden="true" className="mx-auto size-3.5" />
        <span className="sr-only">Yes</span>
      </>
    ) : (
      <Dash />
    ),
  ),
  photoColumn("developed", (photo) =>
    photo.developmentsCount > 0 ? (
      <span className="inline-flex items-center justify-end gap-1.5 font-mono text-xs tabular-nums">
        {photo.favoriteDevelopmentsCount > 0 && (
          <span className="inline-flex items-center gap-0.5 rounded-sm bg-star/12 px-1 py-0.5 text-[11px] font-medium text-star ring-1 ring-star/25">
            <Star aria-hidden="true" className="size-3 fill-star text-star" />
            <span>{photo.favoriteDevelopmentsCount}</span>
            <span className="sr-only">
              {photo.favoriteDevelopmentsCount === 1
                ? " favorite version, "
                : " favorite versions, "}
            </span>
          </span>
        )}
        <span className="rounded-sm bg-subtle px-1.5 py-0.5 text-ink ring-1 ring-line">
          {photo.developmentsCount}
        </span>
      </span>
    ) : (
      <Dash />
    ),
  ),
  photoColumn("posted", (photo) =>
    photo.postLinks.length > 0 ? (
      <div className="inline-flex max-w-full items-center gap-0.5 overflow-x-auto">
        {photo.postLinks.map((post, index) => {
          const PlatformIcon = PLATFORM_ICONS[post.platform];
          const label = PLATFORM_LABELS[post.platform];
          return (
            <a
              key={post.id}
              href={post.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${label} post ${index + 1}`}
              title={`${label}: ${post.url}`}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-ink-muted hover:bg-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            >
              <PlatformIcon aria-hidden="true" className="size-4" />
            </a>
          );
        })}
      </div>
    ) : (
      <Dash />
    ),
  ),
]);

function getPhotoRowId(photo: ApiPhotoSummary) {
  return photo.id;
}

interface HeaderCellProps {
  layout: ColumnLayout;
  children: ReactNode;
}

function HeaderCell({ layout, children }: HeaderCellProps) {
  return (
    <th
      scope="col"
      className={`h-8 border-b border-line text-xs font-medium whitespace-nowrap text-ink-faint ${layout.width} ${layout.className}`}
    >
      {layout.labelHidden ? <span className="sr-only">{children}</span> : children}
    </th>
  );
}

interface TableFrameProps {
  busy: boolean;
  rowCount?: number;
  head: ReactNode;
  children: ReactNode;
}

function TableFrame({ busy, rowCount, head, children }: TableFrameProps) {
  return (
    <table
      aria-label="Photos"
      aria-busy={busy}
      aria-rowcount={rowCount}
      className="w-full table-fixed border-separate border-spacing-0"
    >
      <thead className="sticky top-0 z-10 bg-subtle/80 backdrop-blur-xs">{head}</thead>
      <tbody>{children}</tbody>
    </table>
  );
}

type PhotoTableRow = Row<typeof features, ApiPhotoSummary>;

interface PhotoRowProps {
  row: PhotoTableRow;
  rowIndex: number;
  selected: boolean;
  onOpen: (photoId: string) => void;
}

const PhotoRow = memo(
  function PhotoRow({ row, rowIndex, selected, onOpen }: PhotoRowProps) {
    const photo = row.original;

    return (
      // The row click is a mouse shortcut; the filename and thumbnail buttons are the keyboard path.
      <tr
        data-photo-id={photo.id}
        aria-rowindex={rowIndex}
        aria-current={selected ? "true" : undefined}
        onClick={() => {
          // Finishing a drag over cell text also fires click; let the selection stand.
          if (window.getSelection()?.isCollapsed === false) return;
          onOpen(photo.id);
        }}
        className={`group cursor-pointer ${ROW_CELLS} ${selected ? "bg-accent/10" : "hover:bg-subtle"}`}
      >
        {row.getAllCells().map((cell) => {
          const layout = columnLayout(cell.column.id);
          return (
            <td
              key={cell.id}
              title={layout.title?.(photo)}
              data-preview-start={layout.previewStart || undefined}
              className={`${layout.className} ${layout.bodyClassName ?? ""}`}
            >
              <FlexRender cell={cell} />
            </td>
          );
        })}
      </tr>
    );
  },
  // Appending a page rebuilds every Row object around the same photos, so compare the photo: the
  // cells read nothing else from the row, and the table's handlers come from the live table.
  (previous, next) =>
    previous.row.original === next.row.original &&
    previous.rowIndex === next.rowIndex &&
    previous.selected === next.selected &&
    previous.onOpen === next.onOpen,
);

function SpacerRow({ height }: { height: number }) {
  if (height <= 0) return null;
  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: a spacer row holds nothing focusable.
    <tr aria-hidden="true">
      {/* No colSpan: it would count the display:none columns and add phantom ones to the grid. */}
      <td style={{ height }} className="p-0" />
    </tr>
  );
}

interface LoadMoreStatusProps {
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}

/**
 * Sits below the table rather than in it, so it spans the full width whichever columns are showing.
 * Retry stays mounted while it runs, so a retry that fails again leaves the focus where it was.
 */
function LoadMoreStatus({ loading, failed, onRetry }: LoadMoreStatusProps) {
  return (
    <div
      role="status"
      className="flex h-10 items-center gap-2 border-b border-line px-3 text-xs text-ink-faint"
    >
      <span>{loading ? "Loading more photos…" : "More photos could not be loaded."}</span>
      {failed && (
        <Button
          variant="ghost"
          size="sm"
          aria-disabled={loading}
          onClick={onRetry}
          className="aria-disabled:opacity-50"
        >
          Retry
        </Button>
      )}
    </div>
  );
}

interface PhotoRowsProps {
  rows: PhotoTableRow[];
  selectedPhotoId: string | null;
  scrollContainerRef: RefObject<HTMLElement | null>;
  canLoadMore: boolean;
  onLoadMore: () => void;
  onOpen: (photoId: string) => void;
}

/** Kept apart from the table so that scrolling re-renders only the virtualized body. */
function PhotoRows({
  rows,
  selectedPhotoId,
  scrollContainerRef,
  canLoadMore,
  onLoadMore,
  onOpen,
}: PhotoRowsProps) {
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: OVERSCAN_ROWS,
    // The sticky header sits in the scroll content above the first row.
    paddingStart: HEADER_HEIGHT_PX,
    scrollPaddingStart: HEADER_HEIGHT_PX,
  });

  // Stepping through photos in the detail view leaves the table showing the last one.
  const selectedIndex = selectedPhotoId ? rows.findIndex((r) => r.id === selectedPhotoId) : -1;
  useEffect(() => {
    if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
  }, [selectedIndex, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  const firstItem = virtualItems[0];
  const lastItem = virtualItems[virtualItems.length - 1];
  const lastIndex = lastItem?.index ?? -1;

  // Also covers a first page too short to fill the viewport, which never scrolls.
  useEffect(() => {
    if (canLoadMore && lastIndex >= rows.length - 1 - LOAD_MORE_THRESHOLD_ROWS) onLoadMore();
  }, [canLoadMore, lastIndex, rows.length, onLoadMore]);

  return (
    <>
      <SpacerRow height={(firstItem?.start ?? HEADER_HEIGHT_PX) - HEADER_HEIGHT_PX} />
      {virtualItems.map((item) => {
        const row = rows[item.index];
        if (!row) return null;
        return (
          <PhotoRow
            key={row.id}
            row={row}
            // The header row is 1.
            rowIndex={item.index + 2}
            selected={row.id === selectedPhotoId}
            onOpen={onOpen}
          />
        );
      })}
      <SpacerRow height={virtualizer.getTotalSize() - (lastItem?.end ?? HEADER_HEIGHT_PX)} />
    </>
  );
}

interface PhotoTableProps extends PhotoRowActions {
  photos: ApiPhotoSummary[];
  /** Photos matching the filters, loaded or not. */
  matchedCount: number;
  selectedPhotoId: string | null;
  busy: boolean;
  scrollContainerRef: RefObject<HTMLElement | null>;
  canLoadMore: boolean;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  onLoadMore: () => void;
}

export function PhotoTable({
  photos,
  matchedCount,
  selectedPhotoId,
  busy,
  scrollContainerRef,
  canLoadMore,
  loadingMore,
  loadMoreFailed,
  onLoadMore,
  preview,
  onOpen,
  onToggleFavorite,
}: PhotoTableProps) {
  const table = useTable({
    features,
    columns: PHOTO_COLUMNS,
    data: photos,
    getRowId: getPhotoRowId,
    meta: { preview, onOpen, onToggleFavorite },
  });

  /** The `aria-rowindex` of the first row the running retry will bring in. */
  const retryTargetRef = useRef<number | null>(null);

  function handleRetry() {
    retryTargetRef.current = photos.length + 2;
    onLoadMore();
  }

  // A retry that works removes the focused button; the row taking its place gets the focus.
  useEffect(() => {
    const target = retryTargetRef.current;
    if (target === null || loadingMore) return;
    retryTargetRef.current = null;
    if (loadMoreFailed || document.activeElement !== document.body) return;
    scrollContainerRef.current
      ?.querySelector<HTMLElement>(`tr[aria-rowindex="${target}"] button`)
      ?.focus({ preventScroll: true });
  }, [loadingMore, loadMoreFailed, scrollContainerRef]);

  return (
    <>
      <TableFrame
        busy={busy}
        // A photo edited out of the filters stays loaded, so the loaded rows can outnumber matches.
        rowCount={Math.max(matchedCount, photos.length) + 1}
        head={table.getHeaderGroups().map((group) => (
          <tr key={group.id} aria-rowindex={1}>
            {group.headers.map((header) => (
              <HeaderCell key={header.id} layout={columnLayout(header.column.id)}>
                <FlexRender header={header} />
              </HeaderCell>
            ))}
          </tr>
        ))}
      >
        <PhotoRows
          rows={table.getRowModel().rows}
          selectedPhotoId={selectedPhotoId}
          scrollContainerRef={scrollContainerRef}
          canLoadMore={canLoadMore}
          onLoadMore={onLoadMore}
          onOpen={onOpen}
        />
      </TableFrame>
      {(loadingMore || loadMoreFailed) && (
        <LoadMoreStatus loading={loadingMore} failed={loadMoreFailed} onRetry={handleRetry} />
      )}
    </>
  );
}

/** Static, because it renders on the server, where no table or scroll container exists yet. */
export function PhotoTableSkeleton() {
  return (
    <TableFrame
      busy
      head={
        <tr>
          {COLUMN_KEYS.map((key) => (
            <HeaderCell key={key} layout={COLUMN[key]}>
              {COLUMN[key].label}
            </HeaderCell>
          ))}
        </tr>
      }
    >
      {SKELETON_ROWS.map((row) => (
        <tr key={row} className={ROW_CELLS}>
          {COLUMN_KEYS.map((key) => (
            <td key={key} className={COLUMN[key].className}>
              {key === "thumb" ? (
                <div className="h-8 w-12 animate-pulse rounded-sm bg-subtle" />
              ) : key === "star" ? null : (
                <div className="h-3 animate-pulse rounded-sm bg-subtle" />
              )}
            </td>
          ))}
        </tr>
      ))}
    </TableFrame>
  );
}
