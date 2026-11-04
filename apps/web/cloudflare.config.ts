import { bindings, defineConfig } from "cf/config";

export default defineConfig({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  worker: {
    name: "omoide-web",
    compatibilityDate: "2025-09-02",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "@tanstack/react-start/server-entry",
    domains: ["omoide.nikomaru.dev"],
    workersDev: true,
    previewUrls: true,
    observability: {
      enabled: true,
      headSamplingRate: 1,
      logs: {
        enabled: true,
        headSamplingRate: 1,
        invocationLogs: true,
        persist: true,
      },
    },
    env: {
      DB: bindings.d1({
        name: "omoide",
        id: process.env.CLOUDFLARE_DATABASE_ID ?? "c85f5e5f-b5f2-4840-a395-89cb035ef6ae",
      }),
      PHOTOS_BUCKET: bindings.r2({
        name: process.env.R2_BUCKET_NAME ?? "omoide",
      }),
      BETTER_AUTH_SECRET: bindings.secret({ required: false }),
      BETTER_AUTH_URL: bindings.secret({ required: false }),
      GH_CLIENT_ID: bindings.secret({ required: false }),
      GH_CLIENT_SECRET: bindings.secret({ required: false }),
      ALLOWED_USERS: bindings.secret({ required: false }),
      R2_ACCESS_KEY_ID: bindings.secret({ required: false }),
      R2_SECRET_ACCESS_KEY: bindings.secret({ required: false }),
      R2_BUCKET_NAME: bindings.secret({ required: false }),
      R2_S3_ENDPOINT: bindings.secret({ required: false }),
    },
  },
});
