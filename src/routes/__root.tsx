import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
      <div>
        <p className="font-serif text-6xl italic text-foreground">404</p>
        <p className="mt-3 text-sm tracking-widest uppercase text-muted-foreground">Lost in the wardrobe</p>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
      <div>
        <p className="font-serif text-3xl">Something slipped</p>
        <p className="mt-3 text-xs text-muted-foreground break-words max-w-sm mx-auto">{error.message}</p>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="mt-6 rounded-full bg-primary px-6 py-2.5 text-xs uppercase tracking-widest text-primary-foreground"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" },
      { title: "AURA — Your wardrobe, intelligently styled" },
      { name: "description", content: "AURA is the luxury fashion intelligence app. Digitize your wardrobe, generate editorial outfits with AI, plan your style, and discover what suits you." },
      { name: "theme-color", content: "#f5efe6" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "AURA" },
      { property: "og:title", content: "AURA — Your wardrobe, intelligently styled" },
      { property: "og:description", content: "AURA is the luxury fashion intelligence app. Digitize your wardrobe, generate editorial outfits with AI, plan your style, and discover what suits you." },
      { property: "og:url", content: "https://aura-wardrobe-intelligence.lovable.app/" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "AURA — Your wardrobe, intelligently styled" },
      { name: "twitter:description", content: "Digitize your wardrobe, generate editorial outfits with AI, and plan your style." },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,300;1,400&family=Inter:wght@300;400;500;600&display=swap" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "AURA",
          url: "https://aura-wardrobe-intelligence.lovable.app/",
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "AURA",
          url: "https://aura-wardrobe-intelligence.lovable.app/",
          description: "AURA is a wardrobe intelligence and AI styling service that digitizes your closet, generates outfits, and plans what to wear.",
        }),
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster position="top-center" />
    </QueryClientProvider>
  );
}
