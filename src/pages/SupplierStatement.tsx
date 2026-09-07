import { useParams } from "react-router-dom";
import { Truck } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import AccountStatement from "./reports/AccountStatement";

export default function SupplierStatement() {
  const { id } = useParams();
  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={Truck}
        title="كشف حساب مورد"
        description="عرض حركات وأرصدة المورد"
      />
      <AccountStatement defaultEntityType="supplier" defaultEntityId={id || undefined} lockEntityType />
    </div>
  );
}
