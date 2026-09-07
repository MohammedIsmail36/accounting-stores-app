import { useParams } from "react-router-dom";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import AccountStatement from "./reports/AccountStatement";

export default function CustomerStatement() {
  const { id } = useParams();
  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={Users}
        title="كشف حساب عميل"
        description="عرض حركات وأرصدة العميل"
      />
      <AccountStatement defaultEntityType="customer" defaultEntityId={id || undefined} lockEntityType />
    </div>
  );
}
