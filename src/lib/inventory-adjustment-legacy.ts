/**
 * العقد الحسابي المثبت لتسوية المخزون القديمة.
 *
 * هذا الملف لا يمثل التصميم المستهدف للجرد الفعلي أو محرك الترحيل الذري.
 * وجوده في المرحلة الأولى يثبت الحسابات الحالية قبل استبدال مسار الكتابة
 * المتعدد في React بدوال قاعدة بيانات ذرية في المراحل التالية.
 */

export interface LegacyAdjustmentLineAmounts {
  difference: number;
  totalCost: number;
}

export interface LegacyAdjustmentSummaryLine {
  product_id: string;
  difference: number;
  total_cost: number;
}

export interface LegacyAdjustmentSummary {
  totalGain: number;
  totalLoss: number;
  netDifference: number;
  zeroDifferenceProductCount: number;
}

/** الفرق الحالي = الكمية الفعلية − كمية النظام، والقيمة موجبة في الحالتين. */
export function calculateLegacyAdjustmentLine(
  systemQuantity: number,
  actualQuantity: number,
  unitCost: number,
): LegacyAdjustmentLineAmounts {
  const difference = actualQuantity - systemQuantity;
  return {
    difference,
    totalCost: Math.abs(difference) * unitCost,
  };
}

/**
 * الملخص الحالي يعرض إجمالي الفائض والعجز منفصلين، لكنه يكوّن صافيًا واحدًا
 * لمسار القيد القديم. هذا السلوك موثق لاستخدامه كخط أساس، وليس كهدف مستقبلي.
 */
export function summarizeLegacyAdjustment(
  lines: LegacyAdjustmentSummaryLine[],
): LegacyAdjustmentSummary {
  const totalGain = lines
    .filter((line) => line.difference > 0)
    .reduce((sum, line) => sum + line.total_cost, 0);
  const totalLoss = lines
    .filter((line) => line.difference < 0)
    .reduce((sum, line) => sum + line.total_cost, 0);
  const zeroDifferenceProductCount = lines.filter(
    (line) => Boolean(line.product_id) && line.difference === 0,
  ).length;

  return {
    totalGain,
    totalLoss,
    netDifference: totalGain - totalLoss,
    zeroDifferenceProductCount,
  };
}
