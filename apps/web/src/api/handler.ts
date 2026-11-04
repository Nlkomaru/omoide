import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { openAPIRouteHandler } from "hono-openapi";
import { z } from "zod";
import type { AppDatabase } from "~/db/client";
import { createAuth, createCliApiKey, listUserApiKeys, revokeUserApiKey } from "~/server/auth";
import { type ApiEnv, createAuthMiddleware } from "./middleware";
import { photosRouter } from "./photos";

export function createApiApp(options?: { customDb?: AppDatabase }) {
  const app = new Hono<ApiEnv>().basePath("/api");

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      service: "omoide",
      camera: "SONY ILCE-7C",
    }),
  );

  // Better Auth endpoints (/api/auth/*)
  app.on(["GET", "POST"], "/auth/*", async (c) => {
    const auth = createAuth(c.env, c.req.raw);
    return auth.handler(c.req.raw);
  });

  // Protected v1 API
  const v1 = new Hono<ApiEnv>();
  v1.use("*", createAuthMiddleware(options?.customDb));

  v1.get("/me", async (c) => {
    const actor = c.get("actor");
    const db = c.get("db");
    const apiKeys = await listUserApiKeys(db, actor.userId);
    return c.json({
      actor,
      apiKeys,
    });
  });

  v1.post("/api-keys", async (c) => {
    const actor = c.get("actor");
    const db = c.get("db");
    const body = await c.req.json().catch(() => ({}));
    const schema = z.object({
      name: z.string().min(1).max(64).default("omoide-cli"),
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid key name" }, 400);
    }

    const created = await createCliApiKey(db, actor.userId, parsed.data.name);
    return c.json(created, 201);
  });

  v1.delete("/api-keys/:id", async (c) => {
    const actor = c.get("actor");
    const db = c.get("db");
    const keyId = c.req.param("id");
    const deleted = await revokeUserApiKey(db, actor.userId, keyId);
    if (!deleted) {
      return c.json({ error: "API key not found" }, 404);
    }
    return c.json({ ok: true });
  });

  v1.route("/photos", photosRouter);

  app.route("/v1", v1);

  app.get(
    "/openapi",
    openAPIRouteHandler(app, {
      documentation: {
        info: {
          title: "Omoide REST API",
          version: "0.1.0",
          description:
            "Sony α7C (ILCE-7C) Photo Archive, RAW & Developed Variants, and Social Posts API",
        },
        servers: [{ url: "/", description: "Current Environment" }],
      },
    }),
  );

  app.get(
    "/scalar",
    Scalar({
      url: "/api/openapi",
      theme: "default",
    }),
  );

  return app;
}

export const apiApp = createApiApp();
