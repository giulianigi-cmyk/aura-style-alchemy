import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase-user";

export default defineTool({
  name: "list_wardrobe_items",
  title: "List wardrobe items",
  description: "List the signed-in user's wardrobe items with category, colors, brand, season, price, and worn count. Optionally filter by category, brand, or season.",
  inputSchema: {
    category: z.string().optional().describe("Filter by category, e.g. Tops, Shoes, Bags."),
    brand: z.string().optional().describe("Filter by brand name (case-insensitive contains)."),
    season: z.string().optional().describe("Filter by season, e.g. Winter, Summer, All Seasons."),
    limit: z.number().int().min(1).max(500).optional().describe("Max rows to return, default 100."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ category, brand, season, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    let q = sb.from("wardrobe_items").select(
      "id,category,brand,colors,season,style,occasion,size,price,currency,worn_count,created_at",
    ).order("created_at", { ascending: false }).limit(limit ?? 100);
    if (category) q = q.eq("category", category);
    if (brand) q = q.ilike("brand", `%${brand}%`);
    if (season) q = q.eq("season", season);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { items: data ?? [] },
    };
  },
});
