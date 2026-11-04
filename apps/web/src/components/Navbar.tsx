import { Link, useRouterState } from "@tanstack/react-router";
import { BookOpen, Camera, KeyRound, Layers, Star } from "lucide-react";

export function Navbar() {
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;
  const searchStr = routerState.location.searchStr ?? "";

  const isGalleryAll =
    pathname === "/" &&
    !searchStr.includes("favorite=true") &&
    !searchStr.includes("hasDeveloped=true");
  const isFavorites = pathname === "/" && searchStr.includes("favorite=true");
  const isDeveloped = pathname === "/" && searchStr.includes("hasDeveloped=true");
  const isSettings = pathname.startsWith("/settings");

  return (
    <>
      {/* Desktop Vertical Sidebar (nikomaru-portfolio style) */}
      <aside className="hidden md:flex fixed top-0 left-0 z-40 h-screen w-14 flex-col items-center justify-between border-r border-[#E4E4E7] bg-white/95 py-6 backdrop-blur-sm select-none">
        <Link
          to="/"
          className="vertical-brand font-display-mono text-xs font-semibold tracking-[0.28em] text-[#18181B] hover:text-[#2563EB] transition-colors"
        >
          OMOIDE
        </Link>

        <nav className="flex flex-col items-center gap-5" aria-label="Main">
          <Link
            to="/"
            title="All Photos"
            className={`flex h-9 w-9 items-center justify-center rounded-md border transition-colors ${
              isGalleryAll
                ? "border-[#18181B] bg-[#18181B] text-white"
                : "border-transparent text-[#71717A] hover:border-[#E4E4E7] hover:bg-[#FAFAFA] hover:text-[#18181B]"
            }`}
          >
            <Camera className="h-4 w-4" />
          </Link>

          <a
            href="/?favorite=true"
            title="Favorites & RAW Queue"
            className={`flex h-9 w-9 items-center justify-center rounded-md border transition-colors ${
              isFavorites
                ? "border-[#18181B] bg-[#18181B] text-white"
                : "border-transparent text-[#71717A] hover:border-[#E4E4E7] hover:bg-[#FAFAFA] hover:text-[#18181B]"
            }`}
          >
            <Star className="h-4 w-4" />
          </a>

          <a
            href="/?hasDeveloped=true"
            title="Developed Variants (WebP / PNG / AVIF)"
            className={`flex h-9 w-9 items-center justify-center rounded-md border transition-colors ${
              isDeveloped
                ? "border-[#18181B] bg-[#18181B] text-white"
                : "border-transparent text-[#71717A] hover:border-[#E4E4E7] hover:bg-[#FAFAFA] hover:text-[#18181B]"
            }`}
          >
            <Layers className="h-4 w-4" />
          </a>

          <Link
            to="/settings"
            title="CLI API Keys & Settings"
            className={`flex h-9 w-9 items-center justify-center rounded-md border transition-colors ${
              isSettings
                ? "border-[#18181B] bg-[#18181B] text-white"
                : "border-transparent text-[#71717A] hover:border-[#E4E4E7] hover:bg-[#FAFAFA] hover:text-[#18181B]"
            }`}
          >
            <KeyRound className="h-4 w-4" />
          </Link>
        </nav>

        <div className="flex flex-col items-center gap-3">
          <a
            href="/api/scalar"
            target="_blank"
            rel="noreferrer"
            title="REST API Reference (Scalar)"
            className="flex h-8 w-8 items-center justify-center rounded-md text-[#71717A] hover:bg-[#FAFAFA] hover:text-[#18181B] transition-colors"
          >
            <BookOpen className="h-4 w-4" />
          </a>
        </div>
      </aside>

      {/* Mobile Top Header */}
      <header className="flex md:hidden sticky top-0 z-40 h-14 w-full items-center justify-between border-b border-[#E4E4E7] bg-white/95 px-4 backdrop-blur-sm">
        <Link
          to="/"
          className="font-display-mono text-sm font-semibold tracking-[0.22em] text-[#18181B]"
        >
          OMOIDE
        </Link>
        <nav className="flex items-center gap-2">
          <Link
            to="/"
            className="rounded-md px-2.5 py-1.5 text-xs font-medium text-[#3F3F46] hover:bg-[#FAFAFA]"
          >
            Gallery
          </Link>
          <Link
            to="/settings"
            className="rounded-md px-2.5 py-1.5 text-xs font-medium text-[#3F3F46] hover:bg-[#FAFAFA]"
          >
            API Keys
          </Link>
          <a
            href="/api/scalar"
            target="_blank"
            rel="noreferrer"
            className="rounded-md px-2.5 py-1.5 text-xs font-mono-spec text-[#71717A] hover:bg-[#FAFAFA]"
          >
            API
          </a>
        </nav>
      </header>
    </>
  );
}
