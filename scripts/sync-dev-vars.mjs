import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const rootEnv = resolve(process.cwd(), ".env");
const targetDevVars = resolve(process.cwd(), "apps/web/.dev.vars");

if (!existsSync(rootEnv)) {
  console.error("No .env file found in workspace root. Copy .env.example to .env first.");
  process.exit(1);
}

copyFileSync(rootEnv, targetDevVars);
console.log("Synced root .env -> apps/web/.dev.vars");
