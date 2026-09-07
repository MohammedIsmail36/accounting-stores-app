import { DollarSign } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import ProfitLossReport from "./ProfitLossReport";

export default function ProfitLossPage() {
  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={DollarSign}
        title="تقرير الأرباح والخسائر"
        description="تحليل تفصيلي للإيرادات والمصروفات مع مقارنة شهرية وسنوية"
      />
      <ProfitLossReport />
    </div>
  );
}
