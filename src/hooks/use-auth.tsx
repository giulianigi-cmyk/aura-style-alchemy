import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const APP_URL = "https://preview--aura-style-alchemy.lovable.app";

type AuthCtx = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  recovery: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
  clearRecovery: () => void;
};

const Ctx = createContext<AuthCtx | null>(null);

function detectRecoveryFromUrl(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hash || "";
  const s = window.location.search || "";
  return h.includes("type=recovery") || s.includes("type=recovery");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState<boolean>(() => detectRecoveryFromUrl());

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setLoading(false);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    if (detectRecoveryFromUrl()) setRecovery(true);
    return () => subscription.unsubscribe();
  }, []);

  const value: AuthCtx = {
    user: session?.user ?? null,
    session,
    loading,
    recovery,
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    },
    signUp: async (email, password) => {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: APP_URL },
      });
      return { error: error?.message ?? null };
    },
    signOut: async () => { await supabase.auth.signOut(); },
    resetPassword: async (email) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: APP_URL,
      });
      return { error: error?.message ?? null };
    },
    updatePassword: async (newPassword) => {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      return { error: error?.message ?? null };
    },
    clearRecovery: () => {
      setRecovery(false);
      if (typeof window !== "undefined") {
        try {
          history.replaceState(null, "", window.location.pathname);
        } catch { /* noop */ }
      }
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
