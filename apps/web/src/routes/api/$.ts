import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { apiApp } from "~/api/handler";

async function handleApiRequest({ request }: { request: Request }) {
  return apiApp.fetch(request, env as unknown as Env);
}

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: handleApiRequest,
      POST: handleApiRequest,
      PUT: handleApiRequest,
      PATCH: handleApiRequest,
      DELETE: handleApiRequest,
      OPTIONS: handleApiRequest,
    },
  },
});
