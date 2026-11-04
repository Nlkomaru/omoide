import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";

const NAV_LINK =
  "flex h-7 items-center rounded-md px-2 font-medium text-ink-muted transition-colors hover:bg-subtle hover:text-ink data-[status=active]:bg-subtle data-[status=active]:text-ink";

export function Navbar() {
  return (
    <header className="flex h-11 shrink-0 items-center gap-4 border-b border-line bg-surface px-3">
      <Link to="/" className="rounded-sm font-semibold tracking-tight text-ink">
        Omoide
      </Link>

      <nav className="flex items-center gap-0.5" aria-label="Main">
        <Link to="/" activeOptions={{ exact: true, includeSearch: false }} className={NAV_LINK}>
          Library
        </Link>
        <Link to="/settings" className={NAV_LINK}>
          Settings
        </Link>
      </nav>

      <a
        href="/api/scalar"
        target="_blank"
        rel="noreferrer"
        className="-mr-2 ml-auto flex h-7 items-center gap-1 rounded-md px-2 text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
      >
        API docs
        <ArrowUpRight className="size-3.5 text-ink-faint" aria-hidden="true" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </header>
  );
}
