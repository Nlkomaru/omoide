import { createFileRoute } from "@tanstack/react-router";
import { Check, Copy } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { TextInput } from "~/components/ui/input";
import { Separator } from "~/components/ui/separator";
import { SidebarTrigger } from "~/components/ui/sidebar";
import { formatLocalTime } from "~/lib/format";

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

const AUTH_METHOD_LABELS: Record<string, string> = {
  session: "GitHub session",
  api_key: "API key",
  cf_access: "Cloudflare Access",
  local_owner: "Local owner",
};

const CLI_COMMANDS = [
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
].join("\n");

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line py-6 lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-6">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-2 min-w-0 lg:mt-0">{children}</div>
    </section>
  );
}

function AccountRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-4 py-1">
      <dt className="w-28 shrink-0 text-ink-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** Phones show the date alone, which leaves room for Revoke; the time stays in the title. */
function CreatedCell({ createdAt }: { createdAt: number }) {
  const created = formatLocalTime(createdAt);
  return (
    <td title={created} className="py-1.5 pr-4 whitespace-nowrap text-ink-muted tabular-nums">
      {created.slice(0, 10)}
      <span className="hidden sm:inline">{created.slice(10)}</span>
    </td>
  );
}

function SettingsPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [keyName, setKeyName] = useState("desktop-cli");
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadMe = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/me");
      // Clear on failure so a signed-out visitor is not left looking at the previous account.
      setMe(res.ok ? ((await res.json()) as MeResponse) : null);
    } finally {
      setLoaded(true);
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
      setCopied(false);
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

  async function handleGitHubSignIn() {
    const res = await fetch("/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "github",
        callbackURL: `${window.location.origin}/settings`,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { url?: string };
      if (data.url) {
        window.location.href = data.url;
      }
    }
  }

  async function handleSignOut() {
    await fetch("/api/auth/sign-out", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    setNewlyCreatedKey(null);
    await loadMe();
  }

  const accountAction = !loaded ? null : me?.actor.authMethod === "session" ? (
    <Button onClick={() => void handleSignOut()}>Sign out</Button>
  ) : (
    <Button variant="primary" onClick={() => void handleGitHubSignIn()}>
      Sign in with GitHub
    </Button>
  );

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-surface">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="my-auto h-4" />
        <h1 className="text-sm font-semibold">Settings</h1>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3">
        <Section title="Account">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
            {me ? (
              <dl className="min-w-0">
                <AccountRow label="Name">{me.actor.name}</AccountRow>
                <AccountRow label="Email">{me.actor.email}</AccountRow>
                <AccountRow label="Auth method">
                  {AUTH_METHOD_LABELS[me.actor.authMethod] ?? me.actor.authMethod}
                </AccountRow>
                <AccountRow label="User ID">
                  <span className="font-mono text-xs">{me.actor.userId}</span>
                </AccountRow>
              </dl>
            ) : (
              <p className="text-ink-muted">{loaded ? "Not signed in." : "Loading..."}</p>
            )}
            {accountAction}
          </div>
        </Section>

        <Section title="API keys">
          <p className="text-ink-muted">
            The CLI uses these to upload photos. A key is shown only once, when you create it.
          </p>

          <form onSubmit={handleCreateKey} className="mt-4 flex flex-wrap items-center gap-2">
            <label htmlFor="api-key-name" className="text-ink-muted">
              Name
            </label>
            <TextInput
              id="api-key-name"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="windows-desktop"
              maxLength={64}
              disabled={!me}
              className="w-56"
            />
            <Button type="submit" variant="primary" disabled={!me}>
              Create key
            </Button>
          </form>

          <div aria-live="polite">
            {newlyCreatedKey && (
              <div className="mt-4 rounded-md border border-accent/20 bg-accent/5 p-3">
                <p className="font-medium">Copy this key now. It won't be shown again.</p>
                <div className="mt-2 flex items-center gap-3">
                  <code className="min-w-0 flex-1 font-mono text-xs break-all select-all">
                    {newlyCreatedKey}
                  </code>
                  <Button size="sm" onClick={() => void copyKey()}>
                    {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {me && me.apiKeys.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-xs text-ink-muted">
                  <tr className="border-b border-line">
                    <th scope="col" className="py-1.5 pr-4 font-medium">
                      Name
                    </th>
                    <th scope="col" className="py-1.5 pr-4 font-medium">
                      Key
                    </th>
                    <th scope="col" className="py-1.5 pr-4 font-medium">
                      Created
                    </th>
                    <th scope="col" className="py-1.5">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {me.apiKeys.map((k) => (
                    <tr key={k.id} className="border-b border-line last:border-b-0">
                      <td className="py-1.5 pr-4 break-words">{k.name}</td>
                      <td className="py-1.5 pr-4 font-mono text-xs whitespace-nowrap text-ink-muted">
                        {k.start}...
                      </td>
                      <CreatedCell createdAt={k.createdAt} />
                      <td className="py-1.5 text-right">
                        <Button
                          variant="danger-ghost"
                          size="sm"
                          aria-label={`Revoke ${k.name}`}
                          onClick={() => void handleRevokeKey(k.id)}
                        >
                          Revoke
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {me?.apiKeys.length === 0 && <p className="mt-4 text-ink-muted">No API keys yet.</p>}
          {loaded && !me && <p className="mt-4 text-ink-muted">Sign in to manage API keys.</p>}
        </Section>

        <Section title="CLI">
          <pre className="overflow-x-auto rounded-md bg-subtle p-3 font-mono text-xs leading-relaxed">
            {CLI_COMMANDS}
          </pre>
        </Section>
      </div>
    </main>
  );
}
