/// <reference types="@cloudflare/workers-types" />

declare global {
  interface Env {
    DB: D1Database;
    PHOTOS_BUCKET: R2Bucket;
    BETTER_AUTH_SECRET?: string;
    BETTER_AUTH_URL?: string;
    GH_CLIENT_ID?: string;
    GH_CLIENT_SECRET?: string;
    GITHUB_CLIENT_ID?: string;
    GITHUB_CLIENT_SECRET?: string;
    ALLOWED_USERS?: string;
    R2_ACCESS_KEY_ID?: string;
    R2_SECRET_ACCESS_KEY?: string;
    R2_BUCKET_NAME?: string;
    R2_S3_ENDPOINT?: string;
  }
}

export {};
