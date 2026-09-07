import { ShoppingCart } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import PurchasesReport from "./PurchasesReport";

export default function PurchasesReportPage() {
  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={ShoppingCart}
        title="تقرير المشتريات"
        description="تحليل تفصيلي لحركة المشتريات والمصروفات"
      />
      <PurchasesReport />
    </div>
  );
}
