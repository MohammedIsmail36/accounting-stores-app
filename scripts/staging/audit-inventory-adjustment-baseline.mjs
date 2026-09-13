const STAGING_ORIGIN = "https://dunzfxurefzlaamgghys.supabase.co";
const PAGE_SIZE = 1000;

const number = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const groupCount = (rows, key) =>
  Object.fromEntries(
    [...rows.reduce((map, row) => {
      const value = String(row[key] ?? "null");
      map.set(value, (map.get(value) ?? 0) + 1);
      return map;
    }, new Map())].sort(([a], [b]) => a.localeCompare(b)),
  );

export function buildInventoryAdjustmentBaseline({
  adjustments,
  items,
  movements,
  journalEntries,
}) {
  const adjustmentIds = new Set(adjustments.map((row) => row.id));
  const journalIds = new Set(journalEntries.map((row) => row.id));
  const itemsByAdjustment = new Map();
  const productKeys = new Set();
  let duplicateProducts = 0;
  let formulaMismatches = 0;

  for (const item of items) {
    const bucket = itemsByAdjustment.get(item.adjustment_id) ?? [];
    bucket.push(item);
    itemsByAdjustment.set(item.adjustment_id, bucket);

    const productKey = `${item.adjustment_id}:${item.product_id}`;
    if (productKeys.has(productKey)) duplicateProducts += 1;
    productKeys.add(productKey);

    const expectedDifference = number(item.actual_quantity) - number(item.system_quantity);
    const expectedTotalCost = Math.abs(expectedDifference) * number(item.unit_cost);
    if (
      Math.abs(expectedDifference - number(item.difference)) > 0.0001 ||
      Math.abs(expectedTotalCost - number(item.total_cost)) > 0.01
    ) {
      formulaMismatches += 1;
    }
  }

  const approvedWithoutExpectedJournal = adjustments.filter((adjustment) => {
    if (adjustment.status !== "approved") return false;
    const net = (itemsByAdjustment.get(adjustment.id) ?? []).reduce(
      (sum, item) =>
        sum + (number(item.difference) > 0 ? number(item.total_cost) : -number(item.total_cost)),
      0,
    );
    return Math.abs(net) >= 0.01 && !adjustment.journal_entry_id;
  }).length;

  const movementReferenceIds = new Set(
    movements.map((row) => row.reference_id).filter(Boolean),
  );
  const postedMissingMovements = adjustments.filter((adjustment) => {
    if (adjustment.status !== "approved") return false;
    const hasDifference = (itemsByAdjustment.get(adjustment.id) ?? []).some(
      (item) => Math.abs(number(item.difference)) > 0.0001,
    );
    return hasDifference && !movementReferenceIds.has(adjustment.id);
  }).length;

  return {
    adjustments: adjustments.length,
    statuses: groupCount(adjustments, "status"),
    items: items.length,
    adjustments_without_items: adjustments.filter(
      (row) => !(itemsByAdjustment.get(row.id)?.length > 0),
    ).length,
    orphan_items: items.filter((row) => !adjustmentIds.has(row.adjustment_id)).length,
    duplicate_products_within_document: duplicateProducts,
    formula_mismatches: formulaMismatches,
    linked_journals: adjustments.filter((row) => Boolean(row.journal_entry_id)).length,
    missing_linked_journals: adjustments.filter(
      (row) => row.journal_entry_id && !journalIds.has(row.journal_entry_id),
    ).length,
    approved_without_expected_journal: approvedWithoutExpectedJournal,
    related_movements: movements.length,
    movement_reference_types: groupCount(movements, "reference_type"),
    orphan_movement_references: movements.filter(
      (row) => row.reference_id && !adjustmentIds.has(row.reference_id),
    ).length,
    approved_documents_missing_movements: postedMissingMovements,
  };
}

async function fetchAll(path, serviceKey) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const response = await fetch(`${STAGING_ORIGIN}/rest/v1/${path}`, {
      method: "GET",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Range: `${from}-${from + PAGE_SIZE - 1}`,
      },
    });
    if (!response.ok) {
      throw new Error(`STAGING_READ_FAILED status=${response.status}`);
    }
    const page = await response.json();
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function main() {
  const serviceKey = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("STAGING_SERVICE_KEY_REQUIRED");

  const [adjustments, items, movements, journalEntries] = await Promise.all([
    fetchAll(
      "inventory_adjustments?select=id,adjustment_number,status,journal_entry_id&order=id.asc",
      serviceKey,
    ),
    fetchAll(
      "inventory_adjustment_items?select=id,adjustment_id,product_id,system_quantity,actual_quantity,difference,unit_cost,total_cost&order=id.asc",
      serviceKey,
    ),
    fetchAll(
      "inventory_movements?select=id,reference_id,reference_type,quantity,total_cost&reference_type=in.(adjustment,inventory_adjustment)&order=id.asc",
      serviceKey,
    ),
    fetchAll("journal_entries?select=id&order=id.asc", serviceKey),
  ]);

  console.log(
    JSON.stringify(
      buildInventoryAdjustmentBaseline({
        adjustments,
        items,
        movements,
        journalEntries,
      }),
      null,
      2,
    ),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
