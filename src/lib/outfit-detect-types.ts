// Client-safe schemas/types for the multi-item outfit detector.
// Shared by the server function wrapper, the batch worker and the UI.
import { z } from "zod";

export const DETECT_CATEGORIES = [
  "Tops", "Outerwear", "Bottoms", "Dresses", "Shoes", "Bags", "Accessories", "Underwear",
] as const;

export const DETECT_SEASONS = ["Spring", "Summer", "Autumn", "Winter", "All Seasons"] as const;

export const DetectInputSchema = z.object({
  imageDataUrl: z.string().min(20),
});

export const DetectedItemSchema = z.object({
  category: z.string(),
  subcategory: z.string(),
  colors: z.array(z.string()),
  description: z.string(),
  materials: z.array(z.string()),
  seasons: z.array(z.string()),
  confidence: z.number(),
  bbox: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  formality: z.number().optional(),
  dayEvening: z.string().optional(),
  sleeveLength: z.string().optional(),
  // Same extended attribute set the single-item analyzer already
  // captures (see ai-analyze.functions.ts) — this multi-item detector
  // never asked for them, so a batch/outfit scan always came back with
  // fewer fields than adding one piece at a time.
  length: z.string().optional(),
  fit: z.string().optional(),
  heelHeight: z.string().optional(),
  toeShape: z.string().optional(),
  closure: z.string().optional(),
  gender: z.string().optional(),
  styleTags: z.array(z.string()).optional(),
});

export const DetectOutputSchema = z.object({
  items: z.array(DetectedItemSchema),
});

export type DetectedOutfitItem = z.infer<typeof DetectedItemSchema>;

export type BBox = { x: number; y: number; width: number; height: number };
