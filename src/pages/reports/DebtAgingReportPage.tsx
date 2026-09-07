import { Clock } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import DebtAgingReport from "./DebtAgingReport";

export default function DebtAgingReportPage() {
  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={Clock}
        title="تقرير أعمار الديون"
        description="تحليل الديون المستحقة حسب فترات الاستحقاق"
      />
      <DebtAgingReport />
    </div>
  );
}
