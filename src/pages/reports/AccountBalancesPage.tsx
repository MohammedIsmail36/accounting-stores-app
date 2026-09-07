import { Calculator } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import AccountBalancesReport from "./AccountBalancesReport";

export default function AccountBalancesPage() {
  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={Calculator}
        title="أرصدة الحسابات"
        description="ملخص أرصدة جميع الحسابات النشطة"
      />
      <AccountBalancesReport />
    </div>
  );
}
