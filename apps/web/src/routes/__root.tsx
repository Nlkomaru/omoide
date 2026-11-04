/// <reference types="vite/client" />
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type * as React from "react";
import { Navbar } from "~/components/Navbar";
import appCss from "~/styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Omoide — Sony α7C Photography Archive" },
      {
        name: "description",
        content:
          "Personal photography archive, RAW & developed variants gallery, and EXIF browser for Sony α7C (ILCE-7C).",
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Navbar />
      <div className="min-h-screen bg-white text-[#18181B] md:pl-14">
        <Outlet />
      </div>
    </RootDocument>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <HeadContent />
      </head>
      <body className="bg-white text-[#18181B] antialiased selection:bg-[#18181B] selection:text-white">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
