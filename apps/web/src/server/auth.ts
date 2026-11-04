import { apiKey } from "@better-auth/api-key";
import { uuidv7 } from "@omoide/core";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { and, desc, eq } from "drizzle-orm";
import { type AppDatabase, createDb } from "~/db/client";
import * as schema from "~/db/schema";

const DEFAULT_SECRET = "omoide-dev-secret-change-in-production-32-chars";

export function createAuth(env: Env) {
  const db = createDb(env.DB);
  const allowedUsers = (env.ALLOWED_USERS ?? "")
    .split(",")
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean);

  const ghClientId = env.GH_CLIENT_ID || env.GITHUB_CLIENT_ID;
  const ghClientSecret = env.GH_CLIENT_SECRET || env.GITHUB_CLIENT_SECRET;

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET || DEFAULT_SECRET,
    baseURL: env.BETTER_AUTH_URL || "http://localhost:3000",
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        apikey: schema.apikey,
      },
    }),
    socialProviders:
      ghClientId && ghClientSecret
        ? {
            github: {
              clientId: ghClientId,
              clientSecret: ghClientSecret,
              mapProfileToUser: (profile) => {
                if (
                  allowedUsers.length > 0 &&
                  !allowedUsers.includes(profile.login.toLowerCase())
                ) {
                  throw new Error("Unauthorized GitHub user");
                }
                return {
                  name: profile.name || profile.login,
                  email: profile.email || `${profile.login}@users.noreply.github.com`,
                  image: profile.avatar_url,
                };
              },
            },
          }
        : {},
    plugins: [
      tanstackStartCookies(),
      apiKey({
        defaultPrefix: "omod_",
        enableSessionForAPIKeys: true,
        rateLimit: {
          enabled: false,
        },
      }),
    ],
  });
}

export interface AuthenticatedActor {
  userId: string;
  name: string;
  email: string;
  authMethod: "session" | "api_key" | "cf_access" | "local_owner";
}

export async function sha256HexString(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Resolves the authenticated user from:
 * 1. API Key (`x-api-key: omod_...` or `Authorization: Bearer omod_...`)
 * 2. Better Auth session cookie
 * 3. Cloudflare Zero Trust Access header (`Cf-Access-Authenticated-User-Email`)
 * 4. Local single-owner fallback if GitHub OAuth is not configured
 */
export async function resolveAuthenticatedActor(
  request: Request,
  env: Env,
  db: AppDatabase,
): Promise<AuthenticatedActor | null> {
  const headers = new Headers(request.headers);
  const authHeader = headers.get("authorization");
  if (authHeader?.startsWith("Bearer ") && !headers.has("x-api-key")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (token.startsWith("omod_")) {
      headers.set("x-api-key", token);
    }
  }

  const rawApiKey = headers.get("x-api-key")?.trim();
  if (rawApiKey) {
    // Check direct hash or raw match in `apikey` table
    const hashed = await sha256HexString(rawApiKey);
    const keyRows = await db
      .select()
      .from(schema.apikey)
      .where(eq(schema.apikey.key, hashed))
      .limit(1);

    const matchedKey =
      keyRows[0] ??
      (await db.select().from(schema.apikey).where(eq(schema.apikey.key, rawApiKey)).limit(1))[0];

    if (matchedKey && matchedKey.enabled !== false) {
      const userRows = await db
        .select()
        .from(schema.user)
        .where(eq(schema.user.id, matchedKey.referenceId))
        .limit(1);
      if (userRows[0]) {
        return {
          userId: userRows[0].id,
          name: userRows[0].name,
          email: userRows[0].email,
          authMethod: "api_key",
        };
      }
    }

    // Bootstrap secret key fallback
    if (env.BETTER_AUTH_SECRET && rawApiKey === `omod_${env.BETTER_AUTH_SECRET}`) {
      const owner = await ensureDefaultOwner(db, env);
      return {
        userId: owner.id,
        name: owner.name,
        email: owner.email,
        authMethod: "api_key",
      };
    }
  }

  try {
    const auth = createAuth(env);
    const sessionData = await auth.api.getSession({ headers });
    if (sessionData?.user) {
      return {
        userId: sessionData.user.id,
        name: sessionData.user.name,
        email: sessionData.user.email,
        authMethod: rawApiKey ? "api_key" : "session",
      };
    }
  } catch {
    // Fall through to CF Access or owner bootstrap check
  }

  // Check Cloudflare Zero Trust header
  const cfEmail = headers.get("cf-access-authenticated-user-email");
  if (cfEmail) {
    const userRecord = await ensureOwnerUser(db, {
      id: `cf_${cfEmail.toLowerCase()}`,
      name: cfEmail.split("@")[0] || "Owner",
      email: cfEmail.toLowerCase(),
    });
    return {
      userId: userRecord.id,
      name: userRecord.name,
      email: userRecord.email,
      authMethod: "cf_access",
    };
  }

  // If no GitHub OAuth credentials are set (e.g. local dev or behind Cloudflare Access edge),
  // ensure the default owner exists so gallery viewing & local CLI work seamlessly.
  const ghClientId = env.GH_CLIENT_ID || env.GITHUB_CLIENT_ID;
  const ghClientSecret = env.GH_CLIENT_SECRET || env.GITHUB_CLIENT_SECRET;
  if (!ghClientId || !ghClientSecret) {
    const owner = await ensureDefaultOwner(db, env);
    return {
      userId: owner.id,
      name: owner.name,
      email: owner.email,
      authMethod: "local_owner",
    };
  }

  return null;
}

export async function createCliApiKey(
  db: AppDatabase,
  userId: string,
  name: string,
): Promise<{
  id: string;
  name: string;
  key: string;
  start: string;
  createdAt: number;
}> {
  const randomBytes = new Uint8Array(24);
  crypto.getRandomValues(randomBytes);
  const tokenBody = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const plainKey = `omod_${tokenBody}`;
  const hashedKey = await sha256HexString(plainKey);
  const now = new Date();
  const id = uuidv7(now.getTime());
  const start = plainKey.slice(0, 12);

  await db.insert(schema.apikey).values({
    id,
    configId: "default",
    name,
    start,
    referenceId: userId,
    prefix: "omod_",
    key: hashedKey,
    enabled: true,
    rateLimitEnabled: false,
    createdAt: now,
    updatedAt: now,
  });

  return {
    id,
    name,
    key: plainKey,
    start,
    createdAt: now.getTime(),
  };
}

export async function listUserApiKeys(db: AppDatabase, userId: string) {
  const rows = await db
    .select()
    .from(schema.apikey)
    .where(eq(schema.apikey.referenceId, userId))
    .orderBy(desc(schema.apikey.createdAt));

  return rows.map((r) => ({
    id: r.id,
    name: r.name ?? "CLI Key",
    start: r.start ?? "omod_...",
    prefix: r.prefix ?? "omod_",
    enabled: Boolean(r.enabled),
    createdAt: r.createdAt.getTime(),
  }));
}

export async function revokeUserApiKey(
  db: AppDatabase,
  userId: string,
  keyId: string,
): Promise<boolean> {
  const existing = await db
    .select({ id: schema.apikey.id })
    .from(schema.apikey)
    .where(and(eq(schema.apikey.id, keyId), eq(schema.apikey.referenceId, userId)))
    .limit(1);

  if (!existing[0]) return false;
  await db.delete(schema.apikey).where(eq(schema.apikey.id, keyId));
  return true;
}

export async function ensureDefaultOwner(db: AppDatabase, env: Env) {
  const defaultUsername = (env.ALLOWED_USERS ?? "nikomaru").split(",")[0]?.trim() || "nikomaru";
  return ensureOwnerUser(db, {
    id: `owner_${defaultUsername.toLowerCase()}`,
    name: defaultUsername,
    email: `${defaultUsername.toLowerCase()}@omoide.local`,
  });
}

async function ensureOwnerUser(
  db: AppDatabase,
  input: { id: string; name: string; email: string },
) {
  const existing = await db.select().from(schema.user).where(eq(schema.user.id, input.id)).limit(1);

  if (existing[0]) {
    return existing[0];
  }

  const now = new Date();
  await db
    .insert(schema.user)
    .values({
      id: input.id,
      name: input.name,
      email: input.email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  const created = await db.select().from(schema.user).where(eq(schema.user.id, input.id)).limit(1);

  return (
    created[0] ?? {
      id: input.id,
      name: input.name,
      email: input.email,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    }
  );
}
