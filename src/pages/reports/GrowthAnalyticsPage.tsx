import { BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import GrowthAnalytics from "./GrowthAnalytics";

export default function GrowthAnalyticsPage() {
  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={BarChart3}
        title="لوحة الأداء المالي"
        description="مقارنة دورية لمؤشرات الإيرادات والمصروفات والأرباح مع الفترة السابقة"
      />
      <GrowthAnalytics />
    </div>
  );
}
