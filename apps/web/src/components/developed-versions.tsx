import type { PhotoDevelopmentItem } from "@omoide/core";
import { Star, Trash2, Upload, X } from "lucide-react";
import { type DragEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, IconButton } from "~/components/ui/button";
import { UPLOAD_ACCEPT, type UploadItem, type UploadStatus } from "~/lib/development-upload";
import { formatBytes } from "~/lib/format";

interface DevelopedVersionsProps {
  developments: readonly PhotoDevelopmentItem[];
  /** What to call each version, by id. */
  labels: ReadonlyMap<string, string>;
  hasRaw: boolean;
  selectedVariantId: string;
  postCounts: ReadonlyMap<string, number>;
  /** This photo's uploads. */
  uploads: readonly UploadItem[];
  favoriteFailedId: string | null;
  deletingIds: ReadonlySet<string>;
  deleteFailedId: string | null;
  onSelect: (developmentId: string) => void;
  onToggleFavorite: (development: PhotoDevelopmentItem) => void;
  onDelete: (development: PhotoDevelopmentItem) => void;
  onAddFiles: (files: File[]) => void;
  onRetryUpload: (uploadId: string) => void;
  onDismissUpload: (uploadId: string) => void;
  onClearFinishedUploads: () => void;
}

const STATUS_TEXT: Partial<Record<UploadStatus, string>> = {
  queued: "Waiting",
  uploading: "Uploading…",
  done: "Uploaded",
  duplicate: "Already uploaded",
};

function carriesFiles(e: DragEvent) {
  return e.dataTransfer.types.includes("Files");
}

function isActive({ status }: UploadItem) {
  return status === "queued" || status === "uploading";
}

function isFinished({ status }: UploadItem) {
  return status === "done" || status === "duplicate";
}

function statusText({ status, message }: UploadItem) {
  return (status === "rejected" || status === "failed" ? message : STATUS_TEXT[status]) ?? "";
}

/** Each upload's outcome as one sentence, for a live region that exists before any of them lands. */
function useUploadAnnouncement(uploads: readonly UploadItem[]) {
  const [announcement, setAnnouncement] = useState("");
  const told = useRef(new Map(uploads.map((upload) => [upload.id, upload.status])));

  useEffect(() => {
    const landed = uploads.filter(
      (upload) => !isActive(upload) && told.current.get(upload.id) !== upload.status,
    );
    for (const upload of uploads) told.current.set(upload.id, upload.status);
    if (landed.length > 0) {
      setAnnouncement(landed.map((u) => `${u.file.name}: ${statusText(u)}`).join(". "));
    }
  }, [uploads]);

  return announcement;
}

export function DevelopedVersions({
  developments,
  labels,
  hasRaw,
  selectedVariantId,
  postCounts,
  uploads,
  favoriteFailedId,
  deletingIds,
  deleteFailedId,
  onSelect,
  onToggleFavorite,
  onDelete,
  onAddFiles,
  onRetryUpload,
  onDismissUpload,
  onClearFinishedUploads,
}: DevelopedVersionsProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadButtonRef = useRef<HTMLButtonElement>(null);
  const uploadListRef = useRef<HTMLUListElement>(null);
  /** The row whose Dismiss should take the focus once the list has lost the button that held it. */
  const focusRowRef = useRef<number | null>(null);
  const versionListRef = useRef<HTMLUListElement>(null);
  /** The version being deleted and its row, which the next row takes over when it goes. */
  const deletingRowRef = useRef<{ id: string; index: number } | null>(null);
  /** The version asking "are you sure". */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const uploading = uploads.some(isActive);
  const announcement = useUploadAnnouncement(uploads);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the list has just changed
  useLayoutEffect(() => {
    const row = focusRowRef.current;
    if (row === null) return;
    focusRowRef.current = null;
    const dismissals = uploadListRef.current?.querySelectorAll<HTMLElement>("[data-dismiss]") ?? [];
    (dismissals[Math.min(row, dismissals.length - 1)] ?? uploadButtonRef.current)?.focus();
  }, [uploads]);

  // A deleted row takes the focus with it, unless the user has since moved on.
  useLayoutEffect(() => {
    const deleted = deletingRowRef.current;
    if (deleted === null || developments.some((d) => d.id === deleted.id)) return;
    deletingRowRef.current = null;
    setConfirmingId((id) => (id === deleted.id ? null : id));
    if (document.activeElement !== document.body) return;
    const buttons = versionListRef.current?.querySelectorAll<HTMLElement>("[data-delete]") ?? [];
    (buttons[Math.min(deleted.index, buttons.length - 1)] ?? uploadButtonRef.current)?.focus();
  }, [developments]);

  return (
    <section
      aria-label="Developed versions"
      className={`border-t border-line px-4 py-3 transition-colors ${
        dragging ? "bg-accent/5 outline-2 -outline-offset-2 outline-accent" : ""
      }`}
      onDragOver={(e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        setDragging(false);
        if (!carriesFiles(e)) return;
        e.preventDefault();
        onAddFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-ink">
          Developed versions{" "}
          <span className="font-normal text-ink-faint tabular-nums">{developments.length}</span>
        </h3>
        <div className="flex shrink-0 items-center gap-2">
          {hasRaw && <span className="text-xs text-ink-faint">RAW stored</span>}
          <Button ref={uploadButtonRef} size="sm" onClick={() => inputRef.current?.click()}>
            <Upload aria-hidden="true" />
            Upload
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={UPLOAD_ACCEPT}
            tabIndex={-1}
            aria-label="Choose developed versions to upload"
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              // Clearing it lets the same file be picked again, as a retry after a rejection.
              e.target.value = "";
              if (files.length > 0) onAddFiles(files);
            }}
          />
        </div>
      </div>

      {developments.length === 0 ? (
        <p className="mt-1 text-xs text-ink-faint">
          No developed versions yet. Also available with{" "}
          <code className="font-mono whitespace-nowrap text-ink-muted">omoide sync-developed</code>.
        </p>
      ) : (
        <ul ref={versionListRef} className="mt-1">
          {developments.map((dev, index) => {
            const selected = selectedVariantId === dev.id;
            const posts = postCounts.get(dev.id) ?? 0;
            const name = labels.get(dev.id);
            return (
              <li key={dev.id} className="-mx-2 flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(dev.id)}
                  className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-sm px-2 py-1 text-left text-xs transition-colors ${
                    selected ? "bg-subtle" : "hover:bg-subtle"
                  }`}
                >
                  <span className="min-w-0">
                    <span title={name} className="block truncate font-medium text-ink">
                      {name}
                    </span>
                    <span className="block text-ink-muted tabular-nums">
                      {dev.width} × {dev.height} · {formatBytes(dev.byteSize)}
                      {posts > 0 && (
                        <span className="text-ink-faint">
                          {" "}
                          · {posts} {posts === 1 ? "post" : "posts"}
                        </span>
                      )}
                    </span>
                  </span>
                  {selected && <span className="shrink-0 text-ink-faint">Viewing</span>}
                </button>
                <IconButton
                  size="sm"
                  aria-label={`Favorite version ${name}`}
                  title="Favorite this version"
                  aria-pressed={dev.isFavorite}
                  onClick={() => onToggleFavorite(dev)}
                >
                  <Star
                    aria-hidden="true"
                    className={dev.isFavorite ? "fill-star text-star" : ""}
                  />
                </IconButton>
                <IconButton
                  variant="danger-ghost"
                  size="sm"
                  data-delete={dev.id}
                  aria-label={`Delete version ${name}`}
                  title="Delete this version"
                  aria-expanded={confirmingId === dev.id}
                  aria-disabled={deletingIds.has(dev.id)}
                  onClick={() => {
                    if (!deletingIds.has(dev.id)) {
                      setConfirmingId(confirmingId === dev.id ? null : dev.id);
                    }
                  }}
                >
                  <Trash2 aria-hidden="true" />
                </IconButton>
                {favoriteFailedId === dev.id && (
                  <p role="alert" className="basis-full px-2 pb-1 text-xs text-danger">
                    Could not save this favorite.
                  </p>
                )}
                {deleteFailedId === dev.id && !deletingIds.has(dev.id) && (
                  <p role="alert" className="basis-full px-2 pb-1 text-xs text-danger">
                    Could not delete this version. Try again.
                  </p>
                )}
                {confirmingId === dev.id && (
                  <DeleteConfirmation
                    name={name ?? ""}
                    posts={posts}
                    deleting={deletingIds.has(dev.id)}
                    onCancel={() => {
                      setConfirmingId(null);
                      versionListRef.current
                        ?.querySelector<HTMLElement>(`[data-delete="${CSS.escape(dev.id)}"]`)
                        ?.focus();
                    }}
                    onConfirm={() => {
                      deletingRowRef.current = { id: dev.id, index };
                      onDelete(dev);
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {uploads.length > 0 && (
        <div className="mt-2 border-t border-line pt-1">
          <div className="flex min-h-7 items-center justify-between gap-2 text-xs text-ink-faint">
            <span>Uploads</span>
            {uploads.some(isFinished) && (
              <Button
                variant="ghost"
                size="sm"
                className="-mr-2"
                onClick={() => {
                  focusRowRef.current = 0;
                  onClearFinishedUploads();
                }}
              >
                Clear finished
              </Button>
            )}
          </div>
          <ul ref={uploadListRef} aria-label="Uploads">
            {uploads.map((upload, index) => (
              <UploadRow
                key={upload.id}
                upload={upload}
                onRetry={() => onRetryUpload(upload.id)}
                onDismiss={() => {
                  focusRowRef.current = index;
                  onDismissUpload(upload.id);
                }}
              />
            ))}
          </ul>
        </div>
      )}

      <p role="status" className="sr-only">
        {announcement}
      </p>

      <p className="mt-2 text-xs text-ink-faint">
        {uploading
          ? "Closing is fine; reloading stops uploads."
          : "Drop WebP, PNG, JPEG or AVIF here, up to 50 MB."}
      </p>
    </section>
  );
}

/** Sits under the row it asks about. Escape answers it without closing the whole dialog. */
function DeleteConfirmation({
  name,
  posts,
  deleting,
  onCancel,
  onConfirm,
}: {
  name: string;
  posts: number;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <fieldset
      data-keep-arrow-keys
      className="mx-2 mb-1 min-w-0 basis-full rounded-sm border border-danger/30 p-2 text-xs"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.nativeEvent.isComposing) return;
        e.stopPropagation();
        if (!deleting) onCancel();
      }}
    >
      <legend className="float-left w-full font-medium break-words text-ink">Delete {name}?</legend>
      <p className="clear-left pt-0.5 text-ink-muted">
        The file is removed and this can't be undone.
        {posts > 0 &&
          ` ${posts === 1 ? "Its post stays" : `Its ${posts} posts stay`}, marked as from a deleted version.`}
      </p>
      <div className="mt-2 flex justify-end gap-1">
        {/* Once it's sent the delete can't be called back, so there is nothing to cancel. */}
        <Button
          ref={cancelRef}
          variant="ghost"
          size="sm"
          aria-disabled={deleting}
          className="aria-disabled:opacity-50"
          onClick={() => {
            if (!deleting) onCancel();
          }}
        >
          Cancel
        </Button>
        <Button
          variant="danger-ghost"
          size="sm"
          aria-disabled={deleting}
          className="border border-danger/40 aria-disabled:opacity-50"
          onClick={() => {
            if (!deleting) onConfirm();
          }}
        >
          {deleting ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </fieldset>
  );
}

function UploadRow({
  upload,
  onRetry,
  onDismiss,
}: {
  upload: UploadItem;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { file, status, retryable, retried } = upload;
  const active = isActive(upload);
  const problem = status === "rejected" || status === "failed";
  const retryRef = useRef<HTMLButtonElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);

  // Retry goes away once an attempt lands, and the focus mustn't fall out of the dialog with it.
  const retryHeldFocus = retryRef.current !== null && retryRef.current === document.activeElement;
  useLayoutEffect(() => {
    if (retryHeldFocus && !retryRef.current) dismissRef.current?.focus();
  });

  return (
    <li className="flex min-h-7 items-center gap-2 text-xs">
      <span className="min-w-0 flex-1 py-0.5">
        <span title={file.name} className="block truncate text-ink">
          {file.name}
        </span>
        <span className={`block ${problem ? "text-danger" : "text-ink-muted"}`}>
          {statusText(upload)}
        </span>
      </span>
      {((status === "failed" && retryable) || (active && retried)) && (
        <Button
          ref={retryRef}
          size="sm"
          aria-label={`Retry ${file.name}`}
          aria-disabled={active}
          className={active ? "-mr-2 aria-disabled:opacity-50" : ""}
          onClick={() => {
            if (!active) onRetry();
          }}
        >
          Retry
        </Button>
      )}
      {!active && (
        <IconButton
          ref={dismissRef}
          size="sm"
          data-dismiss
          className="-mr-2"
          aria-label={`Dismiss ${file.name}`}
          onClick={onDismiss}
        >
          <X aria-hidden="true" />
        </IconButton>
      )}
    </li>
  );
}
