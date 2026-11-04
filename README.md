# Omoide

Personal photography archive, web gallery, REST API, and CLI uploader for **Sony α7C (`ILCE-7C`)** images.

## Architecture

| Package                          | Description                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@omoide/core` (`packages/core`) | Deterministic EXIF-timestamp UUIDv7 generation, Sony α7C EXIF normalization, BlurHash helpers, and shared Zod schemas                                                           |
| `@omoide/web` (`apps/web`)       | TanStack Start + Hono OpenAPI REST API + Drizzle ORM (Cloudflare D1) + Cloudflare R2 + Better Auth (`omod_` API keys) + Light-theme gallery UI inspired by `nikomaru-portfolio` |
| `@omoide/cli` (`apps/cli`)       | Fast cross-platform CLI uploader (Windows default paths: `F:\DCIM`, `G:\My Drive\Photography\picture`, and developed `output/` folders; Linux supported)                        |

## Environment & Secrets Management

1. Copy `.env.example` to `.env` and fill in your credentials.
2. Push secrets to GitHub Actions:

   ```bash
   pnpm secrets:push
   # (runs `gh secret set -f .env`)
   ```
3. Sync `.env` to `apps/web/.dev.vars` for local Worker development:

   ```bash
   pnpm env:sync
   ```

## Development

```bash
pnpm install
pnpm dev          # Start @omoide/web locally
pnpm test         # Run unit and integration tests
pnpm check        # Format & lint with Biome
pnpm build        # Build core, web, and cli packages
```
