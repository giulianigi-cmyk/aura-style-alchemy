// Client-safe zod schemas for batch scan server functions.
import { z } from "zod";

export const CreateBatchScanSchema = z.object({
  paths: z.array(z.string().min(3)).min(1).max(200),
});

export const CreateBatchScanFromUrlsSchema = z.object({
  urls: z.array(z.string().trim().min(5)).min(1).max(150),
  accessToken: z.string().optional(),
});

export const ScanIdSchema = z.object({ scanId: z.string().uuid() });

export const DetectedIdSchema = z.object({ id: z.string().uuid() });

export const ConfirmItemSchema = z.object({
  id: z.string().uuid(),
  image_path: z.string().min(3),
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
});

export const ConfirmDetectedItemsSchema = z.object({
  items: z.array(ConfirmItemSchema).min(1).max(50),
});

export type ConfirmItemInput = z.infer<typeof ConfirmItemSchema>;
