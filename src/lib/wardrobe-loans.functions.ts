import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type WardrobeLoan = {
  id: string;
  user_id: string;
  item_id: string;
  borrower_name: string;
  loaned_at: string;
  returned_at: string | null;
  returned_to_location_id: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Everything here works on the SAME wardrobe_items row throughout a
 * loan's lifecycle — no duplicate item is ever created, and nothing is
 * deleted when a loan starts. wardrobe_loans is the append-only history;
 * wardrobe_items.active_loan_id is just a fast pointer to whichever loan
 * (if any) is currently open, so outfit generation and the wardrobe list
 * don't need to join against loan history on every read.
 */

const LendSchema = z.object({
  itemId: z.string().uuid(),
  borrowerName: z.string().trim().min(1).max(80),
});

export const lendItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => LendSchema.parse(input))
  .handler(async ({ data, context }) => {
    // An item already out on loan can't be lent again until it's
    // returned — the UI shouldn't offer this, but enforce it here too.
    const { data: itemRow, error: itemErr } = await (context.supabase.from("wardrobe_items" as never) as any)
      .select("id, active_loan_id").eq("id", data.itemId).eq("user_id", context.userId).maybeSingle();
    if (itemErr) throw new Error(itemErr.message);
    if (!itemRow) throw new Error("Item not found");
    if ((itemRow as { active_loan_id: string | null }).active_loan_id) {
      throw new Error("This item is already on loan.");
    }

    const { data: loanRow, error: loanErr } = await (context.supabase.from("wardrobe_loans" as never) as any)
      .insert({ user_id: context.userId, item_id: data.itemId, borrower_name: data.borrowerName })
      .select("*").single();
    if (loanErr) throw new Error(loanErr.message);

    const { error: updErr } = await (context.supabase.from("wardrobe_items" as never) as any)
      .update({ active_loan_id: (loanRow as { id: string }).id })
      .eq("id", data.itemId).eq("user_id", context.userId);
    if (updErr) throw new Error(updErr.message);

    return { loan: loanRow as WardrobeLoan };
  });

export const listActiveLoans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase.from("wardrobe_loans" as never) as any)
      .select("*").eq("user_id", context.userId).is("returned_at", null)
      .order("loaned_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { loans: (data ?? []) as WardrobeLoan[] };
  });

/** Full history, including already-returned loans — used by a "history"
 *  view where individual mistaken entries can be cleaned up (see
 *  deleteLoanRecord below). Active loans first, then most recently
 *  returned first. */
export const listLoanHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase.from("wardrobe_loans" as never) as any)
      .select("*").eq("user_id", context.userId)
      .order("returned_at", { ascending: false, nullsFirst: true })
      .order("loaned_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { loans: (data ?? []) as WardrobeLoan[] };
  });

const ReturnSchema = z.object({
  loanId: z.string().uuid(),
  returnToLocationId: z.string().uuid().nullable(),
});

export const returnLoan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ReturnSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: loanRow, error: loanErr } = await (context.supabase.from("wardrobe_loans" as never) as any)
      .select("id, item_id").eq("id", data.loanId).eq("user_id", context.userId).maybeSingle();
    if (loanErr) throw new Error(loanErr.message);
    if (!loanRow) throw new Error("Loan not found");
    const itemId = (loanRow as { item_id: string }).item_id;

    const { error: closeErr } = await (context.supabase.from("wardrobe_loans" as never) as any)
      .update({
        returned_at: new Date().toISOString().slice(0, 10),
        returned_to_location_id: data.returnToLocationId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.loanId).eq("user_id", context.userId);
    if (closeErr) throw new Error(closeErr.message);

    // The item comes back into rotation immediately: cleared from the
    // active-loan pointer and moved to wherever the person said it's
    // physically going, both in the same step a real return happens.
    const { error: itemErr } = await (context.supabase.from("wardrobe_items" as never) as any)
      .update({ active_loan_id: null, location_id: data.returnToLocationId })
      .eq("id", itemId).eq("user_id", context.userId);
    if (itemErr) throw new Error(itemErr.message);

    return { ok: true as const };
  });

const DeleteLoanSchema = z.object({ loanId: z.string().uuid() });

/**
 * Deletes a single loan record outright — for fixing a mistaken entry
 * (wrong name, logged by accident), not for a normal return (use
 * returnLoan for that). If this happens to be the item's currently
 * active loan, the item's active-loan pointer is cleared first so it
 * doesn't end up silently "stuck" pointing at a row that no longer
 * exists — but its location is left untouched, since deleting a mistaken
 * entry isn't the same as confirming where the item physically is.
 */
export const deleteLoanRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteLoanSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: loanRow, error: loanErr } = await (context.supabase.from("wardrobe_loans" as never) as any)
      .select("id, item_id").eq("id", data.loanId).eq("user_id", context.userId).maybeSingle();
    if (loanErr) throw new Error(loanErr.message);
    if (!loanRow) throw new Error("Loan not found");

    await (context.supabase.from("wardrobe_items" as never) as any)
      .update({ active_loan_id: null })
      .eq("id", (loanRow as { item_id: string }).item_id).eq("active_loan_id", data.loanId).eq("user_id", context.userId);

    const { error: delErr } = await (context.supabase.from("wardrobe_loans" as never) as any)
      .delete().eq("id", data.loanId).eq("user_id", context.userId);
    if (delErr) throw new Error(delErr.message);

    return { ok: true as const };
  });
