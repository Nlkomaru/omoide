import { AwsClient } from "aws4fetch";

export interface PresignedUrlResult {
  url: string;
  method: "PUT" | "GET";
  expiresInSeconds: number;
}

/**
 * Checks whether S3-compatible R2 credentials are configured for direct presigned URLs.
 */
export function hasR2S3Credentials(env: Env): boolean {
  return Boolean(
    env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_S3_ENDPOINT && env.R2_BUCKET_NAME,
  );
}

/**
 * Generates an S3-compatible presigned PUT or GET URL for Cloudflare R2 using aws4fetch.
 * Useful for direct 50MB+ Sony .ARW RAW uploads/downloads without buffering in Worker memory.
 */
export async function createR2PresignedUrl(
  env: Env,
  options: {
    key: string;
    method: "PUT" | "GET";
    contentType?: string;
    expiresInSeconds?: number;
  },
): Promise<PresignedUrlResult | null> {
  if (
    !env.R2_ACCESS_KEY_ID ||
    !env.R2_SECRET_ACCESS_KEY ||
    !env.R2_S3_ENDPOINT ||
    !env.R2_BUCKET_NAME
  ) {
    return null;
  }

  const expiresInSeconds = options.expiresInSeconds ?? 900;
  const aws = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });

  const endpoint = env.R2_S3_ENDPOINT.replace(/\/+$/, "");
  const targetUrl = new URL(
    `${endpoint}/${env.R2_BUCKET_NAME}/${options.key}?X-Amz-Expires=${expiresInSeconds}`,
  );

  const signedRequest = await aws.sign(
    new Request(targetUrl.toString(), {
      method: options.method,
      headers: options.contentType ? { "content-type": options.contentType } : undefined,
    }),
    {
      aws: { signQuery: true },
    },
  );

  return {
    url: signedRequest.url,
    method: options.method,
    expiresInSeconds,
  };
}

/**
 * Stores an object into Cloudflare R2 via the Worker binding `PHOTOS_BUCKET`.
 */
export async function putR2Object(
  bucket: R2Bucket,
  key: string,
  body: ReadableStream | ArrayBuffer | Uint8Array | string,
  contentType: string,
): Promise<void> {
  await bucket.put(key, body, {
    httpMetadata: {
      contentType,
      cacheControl: "public, max-age=31536000, immutable",
    },
  });
}

/**
 * Removes an object from Cloudflare R2 via the Worker binding `PHOTOS_BUCKET`. R2 treats a key that
 * is already gone as success, so a retry after a partial failure is safe.
 */
export async function deleteR2Object(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key);
}

/**
 * Streams an object from Cloudflare R2 via the Worker binding `PHOTOS_BUCKET`.
 */
export async function getR2ObjectResponse(
  bucket: R2Bucket,
  key: string,
  fallbackContentType = "application/octet-stream",
  downloadFilename?: string,
): Promise<Response> {
  const object = await bucket.get(key);
  if (!object) {
    return new Response("Asset not found in R2", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", fallbackContentType);
  }
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=3600");
  headers.set("x-content-type-options", "nosniff");
  if (downloadFilename) {
    headers.set(
      "content-disposition",
      `attachment; filename="${downloadFilename.replace(/"/g, "")}"`,
    );
  }

  return new Response(object.body, {
    status: 200,
    headers,
  });
}
