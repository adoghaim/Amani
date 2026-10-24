import { z } from "npm:zod@4.6.7";

// Used in `stripe-webhook/index.ts` for the one-time-payment branch
// (`checkout.session.completed` with `mode === "payment"`). The Stripe SDK
// has already verified the signature, so this is a defense-in-depth check
// against unexpected event shapes — we narrow exactly the fields written
// into the `stripe_orders` table before the upsert.
export const StripeCheckoutOrderSchema = z.object({
  id: z.string(),
  payment_intent: z.union([z.string(), z.null()]).optional(),
  amount_subtotal: z.union([z.number(), z.null()]).optional(),
  amount_total: z.union([z.number(), z.null()]).optional(),
  currency: z.union([z.string(), z.null()]).optional(),
  payment_status: z.string(),
});
export type StripeCheckoutOrder = z.infer<typeof StripeCheckoutOrderSchema>;
