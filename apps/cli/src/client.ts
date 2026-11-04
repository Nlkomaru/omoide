import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  ApiPhotoDetail,
  CheckedPhotoStatus,
  CreatePhotoPostRequest,
  ListPhotosResponse,
  PhotoDevelopmentItem,
  PhotoPostItem,
  UploadDevelopmentMetadata,
  UploadPhotoMetadata,
  UploadRawMetadata,
} from "@omoide/core";

export interface CliConfig {
  url: string;
  apiKey: string;
}

export function getConfigFilePath(): string {
  const baseDir =
    process.platform === "win32" && process.env.APPDATA
      ? process.env.APPDATA
      : path.join(os.homedir(), ".config");
  return path.join(baseDir, "omoide", "config.json");
}

export async function loadCliConfig(): Promise<CliConfig> {
  const envUrl = process.env.OMOIDE_API_URL;
  const envKey = process.env.OMOIDE_API_KEY;
  if (envUrl && envKey) {
    return { url: envUrl.replace(/\/+$/, ""), apiKey: envKey };
  }

  const configPath = getConfigFilePath();
  if (existsSync(configPath)) {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<CliConfig>;
    return {
      url: (envUrl ?? parsed.url ?? "http://localhost:3000").replace(/\/+$/, ""),
      apiKey: envKey ?? parsed.apiKey ?? "",
    };
  }

  return {
    url: (envUrl ?? "http://localhost:3000").replace(/\/+$/, ""),
    apiKey: envKey ?? "",
  };
}

export async function saveCliConfig(config: CliConfig): Promise<string> {
  const configPath = getConfigFilePath();
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify(
      {
        url: config.url.replace(/\/+$/, ""),
        apiKey: config.apiKey.trim(),
      },
      null,
      2,
    ),
    "utf8",
  );
  return configPath;
}

export class OmoideApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: CliConfig) {
    this.baseUrl = config.url.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.apiKey) {
      h["x-api-key"] = this.apiKey;
      h.authorization = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  async checkHashes(hashes: string[]): Promise<CheckedPhotoStatus[]> {
    const results: CheckedPhotoStatus[] = [];
    const chunkSize = 500;

    for (let i = 0; i < hashes.length; i += chunkSize) {
      const chunk = hashes.slice(i, i + chunkSize);
      const res = await fetch(`${this.baseUrl}/api/v1/photos/check`, {
        method: "POST",
        headers: this.headers({ "content-type": "application/json" }),
        body: JSON.stringify({ hashes: chunk }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`checkHashes failed (${res.status}): ${text}`);
      }
      const data = (await res.json()) as { items: CheckedPhotoStatus[] };
      results.push(...data.items);
    }

    return results;
  }

  async uploadBasePhoto(
    metadata: UploadPhotoMetadata,
    jpegPath: string,
    thumbAvifBuffer: Buffer | null,
  ): Promise<{ photoId: string; photo: ApiPhotoDetail }> {
    const jpegBytes = await readFile(jpegPath);
    const formData = new FormData();
    formData.append("metadata", JSON.stringify(metadata));
    formData.append(
      "jpeg",
      new Blob([new Uint8Array(jpegBytes)], { type: "image/jpeg" }),
      metadata.originalFilename,
    );

    if (thumbAvifBuffer) {
      formData.append(
        "thumb",
        new Blob([new Uint8Array(thumbAvifBuffer)], { type: "image/avif" }),
        "thumb.avif",
      );
    }

    const res = await fetch(`${this.baseUrl}/api/v1/photos`, {
      method: "POST",
      headers: this.headers(),
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`uploadBasePhoto failed (${res.status}): ${text}`);
    }

    return (await res.json()) as { photoId: string; photo: ApiPhotoDetail };
  }

  async uploadRawFile(
    photoId: string,
    metadata: UploadRawMetadata,
    rawPath: string,
  ): Promise<void> {
    // Request metadata attachment + optional R2 presigned PUT URL
    const initRes = await fetch(`${this.baseUrl}/api/v1/photos/${photoId}/raw`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({
        metadata,
        requestPresignedPut: true,
      }),
    });

    if (!initRes.ok) {
      const text = await initRes.text();
      throw new Error(`uploadRawFile init failed (${initRes.status}): ${text}`);
    }

    const initData = (await initRes.json()) as {
      presignedPutUrl: string | null;
    };

    const rawBytes = new Uint8Array(await readFile(rawPath));

    if (initData.presignedPutUrl) {
      const putRes = await fetch(initData.presignedPutUrl, {
        method: "PUT",
        headers: { "content-type": "image/x-sony-arw" },
        body: rawBytes,
      });
      if (!putRes.ok) {
        throw new Error(`Presigned R2 PUT failed (${putRes.status})`);
      }
      return;
    }

    // Fallback to Worker streaming PUT endpoint
    const fallbackRes = await fetch(`${this.baseUrl}/api/v1/photos/${photoId}/asset/raw`, {
      method: "PUT",
      headers: this.headers({ "content-type": "image/x-sony-arw" }),
      body: rawBytes,
    });

    if (!fallbackRes.ok) {
      const text = await fallbackRes.text();
      throw new Error(`uploadRawFile stream failed (${fallbackRes.status}): ${text}`);
    }
  }

  async uploadDevelopmentVariant(
    photoId: string,
    metadata: UploadDevelopmentMetadata,
    filePath: string,
  ): Promise<PhotoDevelopmentItem> {
    const fileBytes = new Uint8Array(await readFile(filePath));
    const mimeMap: Record<string, string> = {
      webp: "image/webp",
      png: "image/png",
      jpeg: "image/jpeg",
      avif: "image/avif",
    };

    const formData = new FormData();
    formData.append("metadata", JSON.stringify(metadata));
    formData.append(
      "file",
      new Blob([fileBytes], {
        type: mimeMap[metadata.format] ?? "application/octet-stream",
      }),
      path.basename(filePath),
    );

    const res = await fetch(`${this.baseUrl}/api/v1/photos/${photoId}/developments`, {
      method: "POST",
      headers: this.headers(),
      body: formData,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`uploadDevelopmentVariant failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { development: PhotoDevelopmentItem };
    return data.development;
  }

  async addSocialPost(photoId: string, input: CreatePhotoPostRequest): Promise<PhotoPostItem> {
    const res = await fetch(`${this.baseUrl}/api/v1/photos/${photoId}/posts`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`addSocialPost failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { post: PhotoPostItem };
    return data.post;
  }

  async listPhotos(params?: Record<string, string>): Promise<ListPhotosResponse> {
    const search = new URLSearchParams(params);
    const res = await fetch(`${this.baseUrl}/api/v1/photos?${search.toString()}`, {
      headers: this.headers(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`listPhotos failed (${res.status}): ${text}`);
    }

    return (await res.json()) as ListPhotosResponse;
  }
}
