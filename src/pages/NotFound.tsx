import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="text-center max-w-md">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
          <FileQuestion className="h-10 w-10 text-primary" />
        </div>
        <h1 className="mb-2 text-4xl font-bold text-foreground">404</h1>
        <h2 className="mb-3 text-xl font-semibold text-foreground">الصفحة غير موجودة</h2>
        <p className="mb-6 text-muted-foreground">
          الرابط الذي تحاول الوصول إليه غير صحيح أو تم نقله.
        </p>
        <Button asChild>
          <Link to="/">العودة للصفحة الرئيسية</Link>
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
