import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase-user";

export default defineTool({
  name: "get_profile",
  title: "Get profile",
  description: "Return the signed-in user's style profile: name, style preferences, favorite and owned brands, city, and season.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    const { data, error } = await sb
      .from("profiles")
      .select("full_name,gender,birth_date,style_preferences,favorite_brands,owned_brands,city,season,bio")
      .eq("id", ctx.getUserId()!)
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? {}) }],
      structuredContent: { profile: data ?? {} },
    };
  },
});
