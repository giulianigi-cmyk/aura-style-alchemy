import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type OAuthNs = {
  getAuthorizationDetails: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: { redirect_url?: string; redirect_to?: string } | null; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: { redirect_url?: string; redirect_to?: string } | null; error: { message: string } | null }>;
};

type AuthorizationDetails = {
  client?: { name?: string; client_uri?: string } | null;
  scopes?: string[] | null;
  redirect_url?: string;
  redirect_to?: string;
};

function oauthNs(): OAuthNs {
  // The supabase.auth.oauth namespace is beta; type through a narrow wrapper.
  return (supabase.auth as unknown as { oauth: OAuthNs }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      // No dedicated /login route in this app — send to root with a return
      // URL so the app can navigate back after sign-in.
      const back = location.pathname + location.searchStr;
      if (typeof window !== "undefined") {
        try { window.localStorage.setItem("aura:mcp_consent_return", back); } catch { /* ignore */ }
      }
      throw redirect({ to: "/", search: { mcp_return: back } as never });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauthNs().getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-md p-8 font-serif">
      <h1 className="text-2xl">Could not load this authorization request</h1>
      <p className="mt-3 text-sm text-muted-foreground">{String((error as Error)?.message ?? error)}</p>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const ns = oauthNs();
    const res = approve
      ? await ns.approveAuthorization(authorization_id)
      : await ns.denyAuthorization(authorization_id);
    if (res.error) { setBusy(false); setError(res.error.message); return; }
    const target = res.data?.redirect_url ?? res.data?.redirect_to;
    if (!target) { setBusy(false); setError("No redirect returned by the authorization server."); return; }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? "an app";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Authorize access</p>
      <h1 className="mt-4 font-serif text-3xl italic">Connect {clientName} to your AURA</h1>
      <p className="mt-4 text-sm text-muted-foreground">
        {clientName} will be able to read your wardrobe, style profile, and outfit calendar,
        and plan outfits on your behalf. You can revoke access anytime from your account.
      </p>
      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
      <div className="mt-8 flex gap-3">
        <button
          disabled={busy}
          onClick={() => decide(true)}
          className="flex-1 rounded-full bg-primary px-6 py-3 text-xs uppercase tracking-widest text-primary-foreground disabled:opacity-60"
        >
          Approve
        </button>
        <button
          disabled={busy}
          onClick={() => decide(false)}
          className="flex-1 rounded-full border border-border px-6 py-3 text-xs uppercase tracking-widest disabled:opacity-60"
        >
          Deny
        </button>
      </div>
    </main>
  );
}
