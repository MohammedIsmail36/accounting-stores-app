/**
 * Pure aggregation helpers for loyalty transactions.
 *
 * Transaction types and how they affect the period view:
 *  - earn:            +earned   (points usually positive)
 *  - redeem:          +redeemed (points stored negative; we use abs)
 *  - redeem_reversal: +earned   (legacy: a positive entry that returns points)
 *  - reversal:        -earned   (legacy negative reversal)
 *  - cancel_earn:     -earned   (invoice cancellation: stored as negative)
 *  - cancel_redeem:   -redeemed (invoice cancellation refund of redeemed points)
 *  - manual_adjust:   +earned if positive, +redeemed if negative
 */
export interface LoyaltyTx {
  customer_id: string;
  points: number;
  type: string;
}

export interface AggBuckets {
  earned: number;
  redeemed: number;
}

export function applyTx(cur: AggBuckets, t: LoyaltyTx): AggBuckets {
  const next = { earned: cur.earned, redeemed: cur.redeemed };
  switch (t.type) {
    case "earn":
      next.earned += t.points;
      break;
    case "redeem_reversal":
      next.earned += t.points;
      break;
    case "redeem":
      next.redeemed += Math.abs(t.points);
      break;
    case "reversal":
      next.earned -= Math.abs(t.points);
      break;
    case "cancel_earn":
      next.earned -= Math.abs(t.points);
      break;
    case "cancel_redeem":
      next.redeemed -= Math.abs(t.points);
      break;
    case "manual_adjust":
      if (t.points >= 0) next.earned += t.points;
      else next.redeemed += Math.abs(t.points);
      break;
    default:
      break;
  }
  return next;
}

export function aggregateTotals(txs: LoyaltyTx[]): AggBuckets & { net: number } {
  let cur: AggBuckets = { earned: 0, redeemed: 0 };
  for (const t of txs) cur = applyTx(cur, t);
  return { ...cur, net: cur.earned - cur.redeemed };
}

export function aggregateByCustomer(txs: LoyaltyTx[]): Map<string, AggBuckets> {
  const m = new Map<string, AggBuckets>();
  for (const t of txs) {
    const cur = m.get(t.customer_id) || { earned: 0, redeemed: 0 };
    m.set(t.customer_id, applyTx(cur, t));
  }
  return m;
}
