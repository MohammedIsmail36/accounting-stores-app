import { describe, it, expect } from "vitest";
import { aggregateTotals, aggregateByCustomer, LoyaltyTx } from "./loyalty-aggregation";

const C1 = "cust-1";
const C2 = "cust-2";

function tx(type: string, points: number, customer_id = C1): LoyaltyTx {
  return { customer_id, points, type };
}

describe("loyalty aggregation — invoice cancellation edge cases", () => {
  it("earn only — straightforward", () => {
    const r = aggregateTotals([tx("earn", 50)]);
    expect(r).toEqual({ earned: 50, redeemed: 0, net: 50 });
  });

  it("cancel_earn after earn — reduces earned, not redeemed", () => {
    // Invoice earned 50 points, then cancelled → cancel_earn stored as -50
    const r = aggregateTotals([tx("earn", 50), tx("cancel_earn", -50)]);
    expect(r.earned).toBe(0);
    expect(r.redeemed).toBe(0);
    expect(r.net).toBe(0);
  });

  it("cancel_earn works whether points stored as negative or positive", () => {
    // Code in SalesInvoiceForm inserts negative points; be defensive against either sign
    const neg = aggregateTotals([tx("earn", 30), tx("cancel_earn", -30)]);
    const pos = aggregateTotals([tx("earn", 30), tx("cancel_earn", 30)]);
    expect(neg.earned).toBe(0);
    expect(pos.earned).toBe(0);
  });

  it("cancel after partial prior redemption — both buckets net to zero", () => {
    // Earned 100, redeemed 40 on the same invoice, then invoice cancelled:
    // cancel_earn(-100) + cancel_redeem(+40) brings everything back to zero.
    const r = aggregateTotals([
      tx("earn", 100),
      tx("redeem", -40),
      tx("cancel_earn", -100),
      tx("cancel_redeem", 40),
    ]);
    expect(r.earned).toBe(0);
    expect(r.redeemed).toBe(0);
    expect(r.net).toBe(0);
  });

  it("cancel_redeem reduces redeemed bucket (not earned)", () => {
    // CRITICAL: prevents inflating "earned" on cancellation refunds.
    const r = aggregateTotals([tx("redeem", -60), tx("cancel_redeem", 60)]);
    expect(r.earned).toBe(0);
    expect(r.redeemed).toBe(0);
  });

  it("cancellation of one invoice does NOT touch unrelated earned points", () => {
    // Two invoices: A earned 80, B earned 50. Cancel only B.
    const r = aggregateTotals([
      tx("earn", 80),
      tx("earn", 50),
      tx("cancel_earn", -50),
    ]);
    expect(r.earned).toBe(80);
    expect(r.redeemed).toBe(0);
    expect(r.net).toBe(80);
  });

  it("cancel_earn when earn happened outside the period (negative earned bucket is acceptable for period view)", () => {
    // Only the cancel falls in the period window → earned shows -50 within period.
    // This is intentional: it tells the user "this much earning was reversed in this period".
    const r = aggregateTotals([tx("cancel_earn", -50)]);
    expect(r.earned).toBe(-50);
    expect(r.redeemed).toBe(0);
    expect(r.net).toBe(-50);
  });

  it("cancel_redeem alone (refund landed in period, original redeem outside) shows negative redeemed", () => {
    const r = aggregateTotals([tx("cancel_redeem", 30)]);
    expect(r.redeemed).toBe(-30);
    expect(r.net).toBe(30);
  });

  it("manual_adjust positive lands in earned, negative lands in redeemed", () => {
    const r = aggregateTotals([tx("manual_adjust", 20), tx("manual_adjust", -5)]);
    expect(r.earned).toBe(20);
    expect(r.redeemed).toBe(5);
    expect(r.net).toBe(15);
  });

  it("by-customer aggregation isolates cancellations to the right customer", () => {
    const m = aggregateByCustomer([
      tx("earn", 100, C1),
      tx("cancel_earn", -100, C1),
      tx("earn", 70, C2),
    ]);
    expect(m.get(C1)).toEqual({ earned: 0, redeemed: 0 });
    expect(m.get(C2)).toEqual({ earned: 70, redeemed: 0 });
  });

  it("complex scenario: earn → redeem → cancel earn+redeem → re-earn on new invoice", () => {
    const r = aggregateTotals([
      tx("earn", 120),
      tx("redeem", -50),
      tx("cancel_earn", -120),
      tx("cancel_redeem", 50),
      tx("earn", 200),
    ]);
    expect(r.earned).toBe(200);
    expect(r.redeemed).toBe(0);
    expect(r.net).toBe(200);
  });

  it("regression: cancel transactions used to be ignored — earned must not stay inflated", () => {
    // Before fix: cancel_earn wasn't a recognised type, so earned stayed at 100.
    const r = aggregateTotals([tx("earn", 100), tx("cancel_earn", -100)]);
    expect(r.earned).not.toBe(100);
    expect(r.earned).toBe(0);
  });
});
