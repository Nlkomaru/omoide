import { createHash } from "node:crypto";
import type { PhotoDevelopmentItem, UploadDevelopmentMetadata } from "@omoide/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  blurhashSampleSize,
  createUploadQueue,
  detectFormat,
  labelFromFilename,
  MAX_UPLOAD_BYTES,
  type PreparedUpload,
  prepareUpload,
  rejectionReason,
  type SendResult,
  sendUpload,
  type UploadItem,
} from "./developmentUpload";

const WEBP_CONTENTS = "RIFF\0\0\0\0WEBPabc";
const WEBP_SHA = createHash("sha256").update(WEBP_CONTENTS).digest("hex");

function file(name = "edit.webp", type = "image/webp", contents = "abc") {
  return new File([contents], name, { type, lastModified: 1_700_000_000_123 });
}

const facts = async () => ({ width: 40, height: 60, blurhash: "hash" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("detectFormat", () => {
  it("reads the format from the file type", () => {
    expect(detectFormat({ name: "a", type: "image/webp" })).toBe("webp");
    expect(detectFormat({ name: "a", type: "image/png" })).toBe("png");
    expect(detectFormat({ name: "a", type: "image/jpeg" })).toBe("jpeg");
    expect(detectFormat({ name: "a", type: "image/avif" })).toBe("avif");
  });

  it("falls back to the extension only when the type says nothing", () => {
    expect(detectFormat({ name: "a.AVIF", type: "" })).toBe("avif");
    expect(detectFormat({ name: "a.jpg", type: "application/octet-stream" })).toBe("jpeg");
    expect(detectFormat({ name: "a.png", type: "image/gif" })).toBeNull();
    expect(detectFormat({ name: "a.gif", type: "" })).toBeNull();
    expect(detectFormat({ name: "folder", type: "" })).toBeNull();
  });
});

describe("labelFromFilename", () => {
  it("drops only the last extension", () => {
    expect(labelFromFilename("DSC00001.edit.webp")).toBe("DSC00001.edit");
    expect(labelFromFilename("noextension")).toBe("noextension");
  });

  it("never produces an empty label", () => {
    expect(labelFromFilename(".webp")).toBe("default");
  });
});

describe("rejectionReason", () => {
  it("rejects unsupported, empty and oversized files", () => {
    expect(rejectionReason({ name: "a.gif", type: "image/gif", size: 1 })).toMatch(/Not a WebP/);
    expect(rejectionReason({ name: "a.png", type: "image/png", size: 0 })).toMatch(/empty/);
    expect(
      rejectionReason({ name: "a.png", type: "image/png", size: MAX_UPLOAD_BYTES + 1 }),
    ).toMatch(/50 MB/);
  });

  it("accepts a file at the limit", () => {
    expect(
      rejectionReason({ name: "a.png", type: "image/png", size: MAX_UPLOAD_BYTES }),
    ).toBeNull();
  });
});

describe("blurhashSampleSize", () => {
  it("fits inside 32x24 like the CLI's resize", () => {
    expect(blurhashSampleSize(6000, 4000)).toEqual({ width: 32, height: 21 });
    expect(blurhashSampleSize(40, 60)).toEqual({ width: 16, height: 24 });
  });

  it("never enlarges or reaches zero", () => {
    expect(blurhashSampleSize(8, 6)).toEqual({ width: 8, height: 6 });
    expect(blurhashSampleSize(10_000, 1)).toEqual({ width: 32, height: 1 });
  });
});

describe("prepareUpload", () => {
  const webp = (name = "edit.webp", type = "image/webp") => file(name, type, WEBP_CONTENTS);

  it("builds the metadata from the file", async () => {
    const prepared = await prepareUpload(webp("DSC1.edit.webp"), new Set(), facts);

    expect(prepared).toEqual({
      kind: "ready",
      metadata: {
        format: "webp",
        label: "DSC1.edit",
        sha256: WEBP_SHA,
        byteSize: WEBP_CONTENTS.length,
        width: 40,
        height: 60,
        blurhash: "hash",
        developedAt: 1_700_000_000_123,
      },
    });
  });

  it("reports a known sha without decoding the image", async () => {
    const readImage = vi.fn(facts);

    expect(await prepareUpload(webp(), new Set([WEBP_SHA]), readImage)).toEqual({
      kind: "duplicate",
    });
    expect(readImage).not.toHaveBeenCalled();
  });

  it("stores a misnamed file as what its contents are", async () => {
    const prepared = await prepareUpload(webp("edit.png", "image/png"), new Set(), facts);

    expect(prepared).toMatchObject({ kind: "ready", metadata: { format: "webp", label: "edit" } });
  });

  it("rejects contents in no supported format, whatever the name says", async () => {
    const readImage = vi.fn(facts);

    const prepared = await prepareUpload(
      file("edit.webp", "image/webp", "abc"),
      new Set(),
      readImage,
    );

    expect(prepared).toEqual({ kind: "rejected", message: "Not a WebP, PNG, JPEG or AVIF file" });
    expect(readImage).not.toHaveBeenCalled();
  });

  it("rejects an image the browser can't decode", async () => {
    const prepared = await prepareUpload(webp(), new Set(), async () => {
      throw new Error("InvalidStateError");
    });

    expect(prepared).toEqual({ kind: "rejected", message: "This image could not be decoded" });
  });
});

describe("sendUpload", () => {
  const metadata = { sha256: WEBP_SHA } as UploadDevelopmentMetadata;

  function stubFetch(response: Response | Error) {
    const stub = vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    });
    vi.stubGlobal("fetch", stub);
    return stub as unknown as ReturnType<typeof vi.fn<(url: string, init: RequestInit) => unknown>>;
  }

  it("posts the metadata and the file as multipart, leaving the content type to the browser", async () => {
    const development = { id: "dev" } as PhotoDevelopmentItem;
    const stub = stubFetch(Response.json({ development }, { status: 201 }));
    const upload = file();

    expect(await sendUpload("photo", metadata, upload)).toEqual({ ok: true, development });

    const [url, init] = stub.mock.calls[0];
    expect(url).toBe("/api/v1/photos/photo/developments");
    expect(init.method).toBe("POST");
    expect(init.headers).toBeUndefined();
    const body = init.body as FormData;
    expect(JSON.parse(body.get("metadata") as string)).toEqual(metadata);
    expect((body.get("file") as File).name).toBe(upload.name);
  });

  it("uses the server's message and doesn't offer a retry for a 400", async () => {
    stubFetch(
      Response.json({ error: "File hash does not match metadata sha256" }, { status: 400 }),
    );

    expect(await sendUpload("photo", metadata, file())).toEqual({
      ok: false,
      message: "File hash does not match metadata sha256",
      retryable: false,
    });
  });

  it("offers a retry for a plain-text 500 and a network failure", async () => {
    stubFetch(new Response("Internal Server Error", { status: 500 }));
    expect(await sendUpload("photo", metadata, file())).toEqual({
      ok: false,
      message: "Upload failed (500)",
      retryable: true,
    });

    stubFetch(new TypeError("Failed to fetch"));
    expect(await sendUpload("photo", metadata, file())).toEqual({
      ok: false,
      message: "Network error",
      retryable: true,
    });
  });

  it("doesn't offer a retry for a body the platform refused", async () => {
    stubFetch(new Response("<html>", { status: 413 }));

    expect(await sendUpload("photo", metadata, file())).toEqual({
      ok: false,
      message: "Too large for the server",
      retryable: false,
    });
  });
});

function ready(sha256: string): PreparedUpload {
  return { kind: "ready", metadata: { sha256 } as UploadDevelopmentMetadata };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = () => new Promise((resolve) => setTimeout(resolve));

function queueHarness(overrides: Partial<Parameters<typeof createUploadQueue>[0]> = {}) {
  let items: readonly UploadItem[] = [];
  const onUploaded = vi.fn();
  const queue = createUploadQueue({
    onChange: (next) => {
      items = next;
    },
    onUploaded,
    prepare: async (f) => ready(f.name),
    send: async (photoId, metadata) => ({
      ok: true,
      development: { id: metadata.sha256, photoId } as PhotoDevelopmentItem,
    }),
    ...overrides,
  });
  return {
    queue,
    onUploaded,
    statuses: () => items.map((item) => item.status),
    item: (index: number) => items[index],
  };
}

describe("createUploadQueue", () => {
  it("sends one file at a time, in order", async () => {
    const first = deferred<SendResult>();
    const send = vi.fn((_photoId: string, metadata: UploadDevelopmentMetadata) =>
      metadata.sha256 === "a.webp"
        ? first.promise
        : Promise.resolve<SendResult>({
            ok: true,
            development: { id: "b" } as PhotoDevelopmentItem,
          }),
    );
    const { queue, statuses } = queueHarness({ send });

    queue.add("photo", [file("a.webp"), file("b.webp")], []);
    await flush();

    expect(send).toHaveBeenCalledTimes(1);
    expect(statuses()).toEqual(["uploading", "queued"]);

    first.resolve({ ok: true, development: { id: "a" } as PhotoDevelopmentItem });
    await flush();

    expect(send).toHaveBeenCalledTimes(2);
    expect(statuses()).toEqual(["done", "done"]);
  });

  it("rejects bad files up front and still sends the rest", async () => {
    const send = vi.fn<typeof sendUpload>(async () => ({
      ok: true,
      development: { id: "x" } as PhotoDevelopmentItem,
    }));
    const { queue, statuses, item } = queueHarness({ send });

    queue.add("photo", [file("a.gif", "image/gif"), file("b.webp")], []);
    await flush();

    expect(statuses()).toEqual(["rejected", "done"]);
    expect(item(0).message).toMatch(/Not a WebP/);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("treats the second copy of a file in one batch as already uploaded", async () => {
    const send = vi.fn<typeof sendUpload>(async () => ({
      ok: true,
      development: { id: "x" } as PhotoDevelopmentItem,
    }));
    const { queue, statuses } = queueHarness({
      send,
      prepare: async (_file, shas) => (shas.has("same") ? { kind: "duplicate" } : ready("same")),
    });

    queue.add("photo", [file("a.webp"), file("copy of a.webp")], []);
    await flush();

    expect(statuses()).toEqual(["done", "duplicate"]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps known shas per photo", async () => {
    const seen: string[][] = [];
    const { queue } = queueHarness({
      prepare: async (_file, shas) => {
        seen.push([...shas]);
        return ready("sha");
      },
    });

    queue.add("a", [file()], ["on-a"]);
    await flush();
    queue.add("b", [file()], ["on-b"]);
    await flush();

    expect(seen).toEqual([["on-a"], ["on-b"]]);
  });

  it("uploads a file again once its version has been deleted", async () => {
    const prepare: typeof prepareUpload = async (f, shas) =>
      shas.has(f.name) ? { kind: "duplicate" } : ready(f.name);
    const { queue, statuses } = queueHarness({ prepare });

    queue.add("photo", [file("a.webp")], ["a.webp"]);
    await flush();
    expect(statuses()).toEqual(["duplicate"]);

    queue.add("photo", [file("a.webp")], []);
    await flush();
    expect(statuses()).toEqual(["duplicate", "done"]);
  });

  it("retries a failed file from the start and reports it once it lands", async () => {
    const send = vi
      .fn<typeof sendUpload>()
      .mockResolvedValueOnce({ ok: false, message: "Network error", retryable: true })
      .mockResolvedValueOnce({ ok: true, development: { id: "x" } as PhotoDevelopmentItem });
    const prepare = vi.fn<typeof prepareUpload>(async () => ready("sha"));
    const { queue, statuses, item, onUploaded } = queueHarness({ send, prepare });

    queue.add("photo", [file()], []);
    await flush();
    expect(statuses()).toEqual(["failed"]);
    expect(item(0).retryable).toBe(true);
    expect(onUploaded).not.toHaveBeenCalled();

    queue.retry(item(0).id);
    await flush();

    expect(statuses()).toEqual(["done"]);
    expect(item(0).message).toBeNull();
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(onUploaded).toHaveBeenCalledWith("photo", { id: "x" });
  });

  it("tags each upload with its photo whatever was added afterwards", async () => {
    const { queue, onUploaded } = queueHarness();

    queue.add("a", [file("a.webp")], []);
    queue.add("b", [file("b.webp")], []);
    await flush();

    expect(onUploaded.mock.calls.map(([photoId, dev]) => [photoId, dev.id])).toEqual([
      ["a", "a.webp"],
      ["b", "b.webp"],
    ]);
  });

  it("survives a failing completion callback and an unexpected error", async () => {
    const { queue, statuses } = queueHarness({
      onUploaded: async () => {
        throw new Error("no view");
      },
      prepare: async (f) => {
        if (f.name === "boom.webp") throw new Error("boom");
        return ready(f.name);
      },
    });

    queue.add("photo", [file("a.webp"), file("boom.webp"), file("c.webp")], []);
    await flush();

    expect(statuses()).toEqual(["done", "failed", "done"]);
  });

  it("clears one photo's finished uploads and keeps what still needs reading", async () => {
    const { queue, statuses } = queueHarness({
      prepare: async (upload) =>
        upload.name === "rejected.webp"
          ? { kind: "rejected", message: "This image could not be decoded" }
          : upload.name === "same.webp"
            ? { kind: "duplicate" }
            : ready(upload.name),
    });

    queue.add("photo", [file("new.webp"), file("same.webp"), file("rejected.webp")], []);
    queue.add("other", [file("other.webp")], []);
    await flush();
    queue.dismissFinished("photo");

    expect(statuses()).toEqual(["rejected", "done"]);
  });

  it("forgets a dismissed item", async () => {
    const { queue, statuses, item } = queueHarness();

    queue.add("photo", [file()], []);
    await flush();
    queue.dismiss(item(0).id);

    expect(statuses()).toEqual([]);
  });
});
