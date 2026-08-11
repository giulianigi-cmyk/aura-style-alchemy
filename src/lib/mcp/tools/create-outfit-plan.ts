import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase-user";

export default defineTool({
  name: "create_outfit_plan",
  title: "Plan an outfit",
  description: "Create a planned or logged outfit for a given date, composed of wardrobe item IDs. Occasion and notes are optional.",
  inputSchema: {
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date the outfit is for (YYYY-MM-DD)."),
    item_ids: z.array(z.string().uuid()).min(1).describe("Wardrobe item IDs composing the outfit."),
    occasion: z.string().optional().describe("Optional occasion label, e.g. Work, Evening."),
    notes: z.string().optional().describe("Optional free-form note."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ date, item_ids, occasion, notes }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    const { data, error } = await sb
      .from("outfit_plans")
      .upsert({
        user_id: ctx.getUserId()!,
        date,
        item_ids,
        occasion: occasion ?? null,
        notes: notes ?? null,
      }, { onConflict: "user_id,general_date" })
      .select("id,date,item_ids,occasion,notes")
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? {}) }],
      structuredContent: { plan: data ?? {} },
    };
  },
});
