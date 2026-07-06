import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase-user";

export default defineTool({
  name: "list_outfit_plans",
  title: "List outfit plans",
  description: "List the signed-in user's planned or logged outfits between two dates (inclusive, YYYY-MM-DD).",
  inputSchema: {
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Start date, YYYY-MM-DD."),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("End date, YYYY-MM-DD."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from, to }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    const { data, error } = await sb
      .from("outfit_plans")
      .select("id,date,item_ids,occasion,notes,weather_temp,weather_condition")
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: true });
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { plans: data ?? [] },
    };
  },
});
