import {
  type DevelopedFormat,
  detectImageFormat,
  encodeBlurhash,
  type PhotoDevelopmentItem,
  type UploadDevelopmentMetadata,
} from "@omoide/core";

/**
 * The route holds the whole file in Worker memory, at least twice, and Workers get 128 MB. So this
 * sits well below the 100 MB request body limit. It's a cautious estimate, not a measured ceiling.
 * Going over it would look like an endless 5xx with a Retry instead of this clear refusal.
 */
export const MAX_UPLOAD_BYTES = 50_000_000;

export const UPLOAD_ACCEPT =
  "image/webp,image/png,image/jpeg,image/avif,.webp,.png,.jpg,.jpeg,.avif";

const FORMAT_BY_MIME: Record<string, DevelopedFormat> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/avif": "avif",
};

const FORMAT_BY_EXTENSION: Record<string, DevelopedFormat> = {
  webp: "webp",
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
  avif: "avif",
};

/** Browsers report these when they don't recognize a file, which says nothing about its format. */
const UNKNOWN_MIME_TYPES = new Set(["", "application/octet-stream"]);

const BLURHASH_MAX_WIDTH = 32;
const BLURHASH_MAX_HEIGHT = 24;

const UNSUPPORTED_MESSAGE = "Not a WebP, PNG, JPEG or AVIF file";

type NamedFile = Pick<File, "name" | "type">;

/** The file's type decides; the extension only speaks when the browser reports no usable type. */
export function detectFormat({ name, type }: NamedFile): DevelopedFormat | null {
  const mime = type.toLowerCase();
  if (!UNKNOWN_MIME_TYPES.has(mime)) return FORMAT_BY_MIME[mime] ?? null;
  const extension = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase();
  return (extension && FORMAT_BY_EXTENSION[extension]) || null;
}

/** The label for a version: the filename without its extension. */
export function labelFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, "").trim() || "default";
}

/** Why a file can't be sent, judged without reading it. Null when it can be. */
export function rejectionReason(file: Pick<File, "name" | "type" | "size">): string | null {
  if (!detectFormat(file)) return UNSUPPORTED_MESSAGE;
  if (file.size === 0) return "This file is empty";
  if (file.size > MAX_UPLOAD_BYTES) return "Larger than the 50 MB upload limit";
  return null;
}

export function toHex(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Scales down to fit 32x24 and keeps the aspect ratio, as the CLI's `fit: "inside"` resize does. */
export function blurhashSampleSize(width: number, height: number) {
  const scale = Math.min(BLURHASH_MAX_WIDTH / width, BLURHASH_MAX_HEIGHT / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface ImageFacts {
  width: number;
  height: number;
  blurhash: string | null;
}

function encodeBitmapBlurhash(bitmap: ImageBitmap): string | null {
  try {
    const { width, height } = blurhashSampleSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    return encodeBlurhash(context.getImageData(0, 0, width, height).data, width, height);
  } catch {
    return null;
  }
}

/**
 * Decodes the image with its EXIF orientation applied, so the size is what an `<img>` shows. Throws
 * when the browser can't decode the file. A failed blurhash only loses the placeholder.
 */
async function readImageFacts(file: File): Promise<ImageFacts> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    return {
      width: bitmap.width,
      height: bitmap.height,
      blurhash: encodeBitmapBlurhash(bitmap),
    };
  } finally {
    bitmap.close();
  }
}

export type PreparedUpload =
  | { kind: "ready"; metadata: UploadDevelopmentMetadata }
  | { kind: "duplicate" }
  | { kind: "rejected"; message: string };

/** Hashes first, so a file that is already on the photo is never decoded. */
export async function prepareUpload(
  file: File,
  knownShas: ReadonlySet<string>,
  readImage: (file: File) => Promise<ImageFacts> = readImageFacts,
): Promise<PreparedUpload> {
  if (!detectFormat(file)) return { kind: "rejected", message: UNSUPPORTED_MESSAGE };
  // `crypto.subtle` only exists on secure pages, which a dev server on a LAN address is not.
  if (!crypto.subtle) return { kind: "rejected", message: "Hashing needs HTTPS or localhost" };

  let bytes: ArrayBuffer;
  let sha256: string;
  try {
    bytes = await file.arrayBuffer();
    sha256 = toHex(await crypto.subtle.digest("SHA-256", bytes));
  } catch {
    return { kind: "rejected", message: "This file could not be read" };
  }
  if (knownShas.has(sha256)) return { kind: "duplicate" };

  // The server checks the contents too, and a misnamed file should still be stored as what it is.
  const format = detectImageFormat(new Uint8Array(bytes));
  if (!format) return { kind: "rejected", message: UNSUPPORTED_MESSAGE };

  let facts: ImageFacts;
  try {
    facts = await readImage(file);
  } catch {
    return { kind: "rejected", message: "This image could not be decoded" };
  }

  return {
    kind: "ready",
    metadata: {
      format,
      label: labelFromFilename(file.name),
      sha256,
      byteSize: file.size,
      width: facts.width,
      height: facts.height,
      blurhash: facts.blurhash,
      developedAt: Math.floor(file.lastModified),
    },
  };
}

export type SendResult =
  | { ok: true; development: PhotoDevelopmentItem }
  | { ok: false; message: string; retryable: boolean };

/** Sending the same request again can't change these answers. */
const FINAL_STATUSES = new Set([400, 404, 413]);

/** Error bodies may be JSON, or plain text when the platform answers first. */
async function readErrorMessage(res: Response): Promise<string> {
  const fallback =
    res.status === 413 ? "Too large for the server" : `Upload failed (${res.status})`;
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

export async function sendUpload(
  photoId: string,
  metadata: UploadDevelopmentMetadata,
  file: File,
): Promise<SendResult> {
  const body = new FormData();
  body.append("metadata", JSON.stringify(metadata));
  body.append("file", file);

  let res: Response;
  try {
    res = await fetch(`/api/v1/photos/${photoId}/developments`, { method: "POST", body });
  } catch {
    return { ok: false, message: "Network error", retryable: true };
  }
  if (!res.ok) {
    return {
      ok: false,
      message: await readErrorMessage(res),
      retryable: !FINAL_STATUSES.has(res.status),
    };
  }
  try {
    const { development } = (await res.json()) as { development: PhotoDevelopmentItem };
    return { ok: true, development };
  } catch {
    return { ok: false, message: "Unexpected server response", retryable: true };
  }
}

export type UploadStatus = "queued" | "uploading" | "done" | "duplicate" | "rejected" | "failed";

export interface UploadItem {
  id: string;
  photoId: string;
  file: File;
  status: UploadStatus;
  /** Why the file was rejected or failed. */
  message: string | null;
  retryable: boolean;
  /** Set from a Retry on, so the control can stay put while that attempt runs. */
  retried: boolean;
}

interface UploadQueueOptions {
  onChange: (items: readonly UploadItem[]) => void;
  /** Awaited before the next file starts. A rejection doesn't change the upload's outcome. */
  onUploaded: (photoId: string, development: PhotoDevelopmentItem) => Promise<void> | void;
  prepare?: typeof prepareUpload;
  send?: typeof sendUpload;
}

/**
 * Sends files one at a time, in the order they were added. Every item carries its photo, and the
 * queue knows nothing about which photo is on screen, so it can outlive the detail view.
 */
export function createUploadQueue({
  onChange,
  onUploaded,
  prepare = prepareUpload,
  send = sendUpload,
}: UploadQueueOptions) {
  let items: readonly UploadItem[] = [];
  let nextId = 0;
  let running = false;
  const knownShas = new Map<string, Set<string>>();

  function setItems(next: readonly UploadItem[]) {
    items = next;
    onChange(items);
  }

  function update(id: string, patch: Partial<UploadItem>) {
    setItems(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function shasOf(photoId: string) {
    let shas = knownShas.get(photoId);
    if (!shas) {
      shas = new Set();
      knownShas.set(photoId, shas);
    }
    return shas;
  }

  async function run({ id, photoId, file }: UploadItem) {
    update(id, { status: "uploading", message: null, retryable: false });
    const shas = shasOf(photoId);

    const prepared = await prepare(file, shas);
    if (prepared.kind === "duplicate") {
      update(id, { status: "duplicate" });
      return;
    }
    if (prepared.kind === "rejected") {
      update(id, { status: "rejected", message: prepared.message });
      return;
    }

    const result = await send(photoId, prepared.metadata, file);
    if (!result.ok) {
      update(id, { status: "failed", message: result.message, retryable: result.retryable });
      return;
    }

    shas.add(prepared.metadata.sha256);
    update(id, { status: "done" });
    try {
      await onUploaded(photoId, result.development);
    } catch {
      // The file is stored; only the on-screen update was lost.
    }
  }

  async function pump() {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const next = items.find((item) => item.status === "queued");
        if (!next) return;
        try {
          await run(next);
        } catch {
          update(next.id, { status: "failed", message: "Upload failed", retryable: true });
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    /** `existingShas` are the versions the photo has now; files matching them aren't sent. */
    add(photoId: string, files: readonly File[], existingShas: readonly string[]) {
      // Replaced, not added to: a version deleted since is no longer a duplicate.
      knownShas.set(photoId, new Set(existingShas));

      const added = files.map((file): UploadItem => {
        const message = rejectionReason(file);
        nextId += 1;
        return {
          id: `upload-${nextId}`,
          photoId,
          file,
          status: message ? "rejected" : "queued",
          message,
          retryable: false,
          retried: false,
        };
      });
      setItems([...items, ...added]);
      void pump();
    },

    retry(id: string) {
      update(id, { status: "queued", message: null, retryable: false, retried: true });
      void pump();
    },

    dismiss(id: string) {
      setItems(items.filter((item) => item.id !== id));
    },

    /** Clears a photo's settled uploads. Failed and rejected ones wait to be read and dismissed. */
    dismissFinished(photoId: string) {
      setItems(
        items.filter(
          (item) =>
            item.photoId !== photoId || (item.status !== "done" && item.status !== "duplicate"),
        ),
      );
    },
  };
}
