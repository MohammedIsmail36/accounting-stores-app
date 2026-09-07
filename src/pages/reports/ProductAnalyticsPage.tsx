import { Award } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import ProductAnalytics from "./ProductAnalytics";

export default function ProductAnalyticsPage() {
  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={Award}
        title="تحليل المنتجات"
        description="أداء المنتجات والأصناف الأكثر مبيعاً وربحية"
      />
      <ProductAnalytics />
    </div>
  );
}
