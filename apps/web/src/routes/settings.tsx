import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy, KeyRound, Plus, Terminal, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface ApiKeyItem {
  id: string;
  name: string;
  start: string;
  prefix: string;
  enabled: boolean;
  createdAt: number;
}

interface MeResponse {
  actor: {
    userId: string;
    name: string;
    email: string;
    authMethod: string;
  };
  apiKeys: ApiKeyItem[];
}

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [keyName, setKeyName] = useState("desktop-cli");
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadMe = useCallback(async () => {
    const res = await fetch("/api/v1/me");
    if (res.ok) {
      const data = (await res.json()) as MeResponse;
      setMe(data);
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/v1/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: keyName.trim() || "desktop-cli" }),
    });
    if (res.ok) {
      const created = (await res.json()) as { key: string };
      setNewlyCreatedKey(created.key);
      await loadMe();
    }
  }

  async function handleRevokeKey(id: string) {
    const res = await fetch(`/api/v1/api-keys/${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      await loadMe();
    }
  }

  async function copyKey() {
    if (!newlyCreatedKey) return;
    await navigator.clipboard.writeText(newlyCreatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-8 md:py-12 space-y-8">
      <header className="space-y-2 border-b border-[#E4E4E7] pb-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#E4E4E7] bg-[#FAFAFA] px-3 py-1 font-mono-spec text-xs text-[#3F3F46]">
          <KeyRound className="h-3.5 w-3.5 text-[#18181B]" />
          <span>AUTHENTICATION &amp; CLI KEYS</span>
        </div>
        <h1 className="font-display-mono text-2xl font-bold text-[#18181B]">
          Settings &amp; CLI Uploader Credentials
        </h1>
        <p className="text-sm text-[#71717A]">
          Issue <code className="font-mono-spec text-[#18181B]">omod_...</code> API keys for the
          Linux / Windows CLI uploader (
          <code className="font-mono-spec text-[#18181B]">@omoide/cli</code>).
        </p>
      </header>

      {/* Current User Card */}
      {me && (
        <section className="rounded-xl border border-[#E4E4E7] bg-[#FAFAFA] p-5 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-[#71717A]">
            Active Owner Session
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 font-mono-spec text-xs">
            <div className="rounded-md border border-[#E4E4E7] bg-white p-3">
              <div className="text-[10px] text-[#71717A]">User ID</div>
              <div className="mt-0.5 font-medium text-[#18181B]">{me.actor.userId}</div>
            </div>
            <div className="rounded-md border border-[#E4E4E7] bg-white p-3">
              <div className="text-[10px] text-[#71717A]">Owner</div>
              <div className="mt-0.5 font-medium text-[#18181B]">
                {me.actor.name} ({me.actor.email})
              </div>
            </div>
            <div className="rounded-md border border-[#E4E4E7] bg-white p-3">
              <div className="text-[10px] text-[#71717A]">Auth Method</div>
              <div className="mt-0.5 font-medium text-[#18181B]">{me.actor.authMethod}</div>
            </div>
          </div>
        </section>
      )}

      {/* Create New CLI Key */}
      <section className="rounded-xl border border-[#E4E4E7] bg-white p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display-mono text-sm font-semibold text-[#18181B]">
              CLI API Keys (omod_...)
            </h2>
            <p className="text-xs text-[#71717A]">
              Used by <code className="font-mono-spec">omoide auth</code> on Windows (`F:\DCIM`,
              `G:\My Drive\Photography\picture`) or Linux.
            </p>
          </div>
        </div>

        <form onSubmit={handleCreateKey} className="flex flex-wrap gap-2">
          <input
            type="text"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            placeholder="Key label (e.g., windows-desktop)"
            className="min-w-[240px] flex-1 rounded-lg border border-[#E4E4E7] bg-[#FAFAFA] px-3 py-2 font-mono-spec text-xs text-[#18181B]"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#18181B] px-4 py-2 text-xs font-medium text-white hover:bg-[#3F3F46]"
          >
            <Plus className="h-3.5 w-3.5" />
            Generate API Key
          </button>
        </form>

        {newlyCreatedKey && (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50/70 p-4 space-y-2">
            <div className="text-xs font-semibold text-emerald-900">
              API Key Created — Copy now (shown only once):
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded border border-emerald-200 bg-white px-3 py-2 font-mono-spec text-xs text-[#18181B]">
                {newlyCreatedKey}
              </code>
              <button
                type="button"
                onClick={() => void copyKey()}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-medium text-emerald-900 hover:bg-emerald-100"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" /> Copy
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2 pt-2">
          {me?.apiKeys.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[#E4E4E7] p-4 text-center text-xs text-[#71717A]">
              No API keys created yet.
            </div>
          ) : (
            me?.apiKeys.map((k) => (
              <div
                key={k.id}
                className="flex items-center justify-between rounded-lg border border-[#E4E4E7] bg-[#FAFAFA] px-4 py-2.5 text-xs"
              >
                <div className="space-y-0.5">
                  <div className="font-medium text-[#18181B]">{k.name}</div>
                  <div className="font-mono-spec text-[11px] text-[#71717A]">
                    {k.start}... · Created {new Date(k.createdAt).toLocaleString("ja-JP")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRevokeKey(k.id)}
                  className="inline-flex items-center gap-1 rounded border border-[#E4E4E7] bg-white px-2.5 py-1 text-[#71717A] hover:border-red-300 hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Revoke
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      {/* CLI Usage Quick Reference */}
      <section className="rounded-xl border border-[#E4E4E7] bg-[#FAFAFA] p-5 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#71717A]">
          <Terminal className="h-3.5 w-3.5" />
          <span>Windows &amp; Linux CLI Commands</span>
        </div>
        <pre className="overflow-x-auto rounded-lg border border-[#E4E4E7] bg-white p-4 font-mono-spec text-xs leading-relaxed text-[#18181B]">
          {[
            "# 1. Configure server URL and API key",
            "pnpm --filter @omoide/cli dev auth --url http://localhost:3000 --api-key omod_...",
            "",
            "# 2. Sync base JPEGs from Windows default drives (F:\\DCIM and G:\\My Drive\\Photography\\picture)",
            "pnpm --filter @omoide/cli dev sync",
            "",
            "# 3. Sync a developed session folder (pairs .ARW + output/webp/* + output/png/*)",
            'pnpm --filter @omoide/cli dev sync-developed "D:\\Pictures\\photos\\2026-06-16_higashiyama"',
            "",
            "# 4. Upload .ARW RAW files for photos favorited in the Web UI",
            "pnpm --filter @omoide/cli dev sync-favorites",
          ].join("\n")}
        </pre>
      </section>
    </main>
  );
}
