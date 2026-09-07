import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

const Forbidden = () => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="text-center max-w-md">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-destructive/10">
          <ShieldAlert className="h-10 w-10 text-destructive" />
        </div>
        <h1 className="mb-2 text-4xl font-bold text-foreground">403</h1>
        <h2 className="mb-3 text-xl font-semibold text-foreground">غير مصرّح بالوصول</h2>
        <p className="mb-6 text-muted-foreground">
          ليس لديك الصلاحية الكافية لعرض هذه الصفحة. يُرجى التواصل مع المسؤول إذا كنت تعتقد أن هذا خطأ.
        </p>
        <Button asChild>
          <Link to="/">العودة للصفحة الرئيسية</Link>
        </Button>
      </div>
    </div>
  );
};

export default Forbidden;
