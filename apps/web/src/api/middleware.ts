import { createMiddleware } from "hono/factory";
import { type AppDatabase, createDb } from "~/db/client";
import { type AuthenticatedActor, resolveAuthenticatedActor } from "~/server/auth";

export interface ApiEnv {
  Bindings: Env;
  Variables: {
    db: AppDatabase;
    actor: AuthenticatedActor;
  };
}

export function createAuthMiddleware(customDb?: AppDatabase) {
  return createMiddleware<ApiEnv>(async (c, next) => {
    const db = customDb ?? createDb(c.env.DB);
    c.set("db", db);

    const actor = await resolveAuthenticatedActor(c.req.raw, c.env, db);
    if (!actor) {
      return c.json(
        {
          error: "Unauthorized",
          message: "Valid session cookie or omod_... API key is required to access this endpoint.",
        },
        401,
      );
    }

    c.set("actor", actor);
    await next();
  });
}
