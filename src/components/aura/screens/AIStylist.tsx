import { Check, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Screen } from "../AuraApp";
import { supabase, type WardrobeItem, type Outfit } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export function AIStylist({ go: _go }: { go: (s: Screen) => void }) {
  const { user } = useAuth();
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    if (!user) return;
    const [{ data: i }, { data: o }] = await Promise.all([
      supabase.from("wardrobe_items").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("outfits").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
    ]);
    setItems((i ?? []) as WardrobeItem[]);
    setOutfits((o ?? []) as Outfit[]);
  };
  useEffect(() => { load(); }, [user]);

  const toggle = (id: string) =>
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const aiPick = () => {
    if (items.length < 2) return;
    const shuffled = [...items].sort(() => Math.random() - 0.5);
    setSelected(shuffled.slice(0, Math.min(3, items.length)).map(i => i.id));
    setName("AI styled look");
    setCreating(true);
  };

  const save = async () => {
    if (!user || selected.length === 0) return;
    setSaving(true);
    const cover = items.find(i => i.id === selected[0])?.image_url ?? null;
    await supabase.from("outfits").insert({
      user_id: user.id,
      name: name || "Untitled look",
      item_ids: selected,
      cover_url: cover,
    });
    setSelected([]); setName(""); setCreating(false); setSaving(false);
    load();
  };

  return (
    <div className="h-full overflow-y-auto no-scrollbar pb-28">
      <header className="px-6 pt-14">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Atelier</p>
        <h1 className="font-serif text-4xl mt-1 italic">Style a look</h1>
      </header>

      <div className="mx-6 mt-6 flex gap-2">
        <button
          onClick={aiPick}
          className="flex-1 h-12 rounded-full bg-foreground text-background flex items-center justify-center gap-2 active:scale-[0.98] shadow-luxe"
        >
          <Sparkles size={14} />
          <span className="text-xs uppercase tracking-[0.3em]">AI suggest</span>
        </button>
        <button
          onClick={() => setCreating(true)}
          className="flex-1 h-12 rounded-full border border-foreground text-foreground text-xs uppercase tracking-[0.3em] active:scale-[0.98]"
        >Build manually</button>
      </div>

      {creating && (
        <div className="mx-6 mt-6 rounded-2xl border border-border bg-card p-4 animate-fade-up">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Composing</p>
            <button onClick={() => { setCreating(false); setSelected([]); }}><X size={16} /></button>
          </div>
          <input
            value={name} onChange={e => setName(e.target.value)} placeholder="Name this look"
            className="mt-2 w-full bg-transparent font-serif text-xl outline-none placeholder:text-muted-foreground/50"
          />
          <p className="text-xs text-muted-foreground mt-1">{selected.length} pieces selected</p>

          <div className="mt-4 grid grid-cols-3 gap-2 max-h-72 overflow-y-auto">
            {items.map(it => {
              const on = selected.includes(it.id);
              return (
                <button key={it.id} onClick={() => toggle(it.id)} className={`relative rounded-xl overflow-hidden aspect-square transition ${on ? "ring-2 ring-foreground" : ""}`}>
                  <img src={it.image_url} alt={it.name} className="h-full w-full object-cover" />
                  {on && (
                    <div className="absolute top-1 right-1 h-5 w-5 rounded-full bg-foreground text-background flex items-center justify-center">
                      <Check size={11} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <button
            onClick={save} disabled={saving || selected.length === 0}
            className="mt-5 w-full h-12 rounded-full bg-foreground text-background uppercase tracking-[0.3em] text-xs disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Save outfit
          </button>
        </div>
      )}

      <section className="px-6 mt-10">
        <h2 className="font-serif text-2xl italic mb-3">Saved looks</h2>
        {outfits.length === 0 ? (
          <p className="text-sm text-muted-foreground">No outfits yet. Compose your first.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {outfits.map(o => (
              <div key={o.id} className="animate-fade-up">
                <div className="rounded-2xl overflow-hidden bg-secondary/40 aspect-[3/4] shadow-soft">
                  {o.cover_url && <img src={o.cover_url} alt={o.name} className="h-full w-full object-cover" />}
                </div>
                <p className="mt-2 font-serif text-base">{o.name}</p>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{o.item_ids.length} pieces</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
