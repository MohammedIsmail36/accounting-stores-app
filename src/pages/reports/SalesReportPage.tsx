import { BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import SalesReport from "@/features/sales-report/components/SalesReport";

export default function SalesReportPage() {
  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={BarChart3}
        title="تقرير المبيعات"
        description="تحليل تفصيلي لحركة المبيعات والإيرادات"
      />
      <SalesReport />
    </div>
  );
}
