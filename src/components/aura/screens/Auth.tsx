import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Sparkles, ArrowLeft } from "lucide-react";

type Mode = "signin" | "signup" | "forgot";

export function Auth() {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const reset = () => { setError(null); setInfo(null); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    reset(); setLoading(true);
    if (mode === "forgot") {
      const { error } = await resetPassword(email);
      setLoading(false);
      if (error) setError(error);
      else setInfo("Check your inbox for a password reset link.");
      return;
    }
    const fn = mode === "signin" ? signIn : signUp;
    const { error } = await fn(email, password);
    setLoading(false);
    if (error) setError(error);
    else if (mode === "signup") setInfo("Check your email to confirm, or sign in if confirmation is disabled.");
  };

  const title =
    mode === "signin" ? "Welcome back" :
    mode === "signup" ? "Begin your edit" :
    "Reset your password";
  const subtitle =
    mode === "signin" ? "Your wardrobe is waiting." :
    mode === "signup" ? "Create an account to digitize your closet." :
    "We'll email you a secure recovery link.";

  return (
    <div className="h-full w-full flex flex-col px-8 pt-20 pb-10 bg-background">
      <div className="flex-1 flex flex-col justify-center animate-fade-up">
        <div className="flex items-center gap-2 mb-6">
          {mode === "forgot" ? (
            <button onClick={() => { setMode("signin"); reset(); }} className="flex items-center gap-2 text-muted-foreground">
              <ArrowLeft size={14} />
              <span className="text-[10px] uppercase tracking-[0.4em]">Back</span>
            </button>
          ) : (
            <>
              <Sparkles size={14} />
              <span className="text-[10px] uppercase tracking-[0.4em] text-muted-foreground">AURA</span>
            </>
          )}
        </div>
        <h1 className="font-serif text-4xl italic leading-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <div>
            <label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Email</label>
            <input
              type="email" required value={email} onChange={e => setEmail(e.target.value)}
              className="mt-1 w-full bg-transparent border-b border-border py-2 outline-none focus:border-foreground transition"
            />
          </div>
          {mode !== "forgot" && (
            <div>
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Password</label>
                {mode === "signin" && (
                  <button type="button" onClick={() => { setMode("forgot"); reset(); }}
                    className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground hover:text-foreground transition">
                    Forgot?
                  </button>
                )}
              </div>
              <input
                type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)}
                className="mt-1 w-full bg-transparent border-b border-border py-2 outline-none focus:border-foreground transition"
              />
            </div>
          )}

          {error && <p className="text-xs text-red-700">{error}</p>}
          {info && <p className="text-xs text-muted-foreground">{info}</p>}

          <button
            type="submit" disabled={loading}
            className="mt-4 w-full h-14 rounded-full bg-foreground text-background uppercase tracking-[0.3em] text-xs disabled:opacity-50 active:scale-[0.98] transition shadow-luxe"
          >
            {loading ? "…" :
              mode === "signin" ? "Sign in" :
              mode === "signup" ? "Create account" :
              "Send reset link"}
          </button>
        </form>

        {mode !== "forgot" && (
          <button
            onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); reset(); }}
            className="mt-6 text-xs text-muted-foreground tracking-wide"
          >
            {mode === "signin" ? "New to AURA? Create an account" : "Already a member? Sign in"}
          </button>
        )}
      </div>
    </div>
  );
}
