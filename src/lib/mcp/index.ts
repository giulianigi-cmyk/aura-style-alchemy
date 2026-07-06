import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listWardrobeItems from "./tools/list-wardrobe-items";
import getProfile from "./tools/get-profile";
import listOutfitPlans from "./tools/list-outfit-plans";
import createOutfitPlan from "./tools/create-outfit-plan";

// The OAuth issuer MUST be the direct Supabase host (RFC 8414 issuer match).
// Read the project ref from Vite's inlined env; the fallback keeps the
// issuer well-formed during the throwaway manifest-extract eval.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "aura-mcp",
  title: "AURA Wardrobe",
  version: "0.1.0",
  instructions:
    "Tools to read a user's AURA wardrobe, style profile, and outfit calendar, and to plan outfits on their behalf. All data is scoped to the signed-in AURA user.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listWardrobeItems, getProfile, listOutfitPlans, createOutfitPlan],
});
