// Client-safe zod schemas for batch scan server functions.
import { z } from "zod";

export const CreateBatchScanSchema = z.object({
  paths: z.array(z.string().min(3)).min(1).max(200),
});

export const CreateBatchScanFromUrlsSchema = z.object({
  urls: z.array(z.string().trim().min(5)).min(1).max(150),
  accessToken: z.string().optional(),
});

export const ResolveBatchUrlCandidatesSchema = z.object({
  urls: z.array(z.string().trim().min(5)).min(1).max(150),
  accessToken: z.string().optional(),
});

export const UrlSelectionSchema = z.object({
  sourceUrl: z.string().min(5),
  chosenImageUrl: z.string().min(5),
  brand: z.string().nullable().optional(),
  priceValue: z.number().nullable().optional(),
  priceCurrency: z.string().nullable().optional(),
  materials: z.array(z.string()).default([]),
});

export const CreateBatchScanFromSelectionsSchema = z.object({
  selections: z.array(UrlSelectionSchema).min(1).max(150),
});

export const ScanIdSchema = z.object({ scanId: z.string().uuid() });

export const DetectedIdSchema = z.object({ id: z.string().uuid() });

export const ConfirmItemSchema = z.object({
  id: z.string().uuid(),
  image_path: z.string().min(3),
  thumbnail_path: z.string().min(3).nullable().optional(),
  category: z.string().nullable().optional(),
  subcategory: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  colors: z.array(z.string()).default([]),
  material: z.array(z.string()).default([]),
  season: z.string().nullable().optional(),
  style: z.string().nullable().optional(),
  occasion: z.string().nullable().optional(),
  price: z.number().positive().nullable().optional(),
  currency: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
  purchase_date: z.string().nullable().optional(),
  sleeve_length: z.string().nullable().optional(),
  formality: z.number().nullable().optional(),
  day_evening: z.string().nullable().optional(),
  length: z.string().nullable().optional(),
  fit: z.string().nullable().optional(),
  heel_height: z.string().nullable().optional(),
  toe_shape: z.string().nullable().optional(),
  closure: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  style_tags: z.array(z.string()).default([]),
});

export const ConfirmDetectedItemsSchema = z.object({
  items: z.array(ConfirmItemSchema).min(1).max(50),
});

export type ConfirmItemInput = z.infer<typeof ConfirmItemSchema>;
