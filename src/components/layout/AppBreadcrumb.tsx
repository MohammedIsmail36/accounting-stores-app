import { useLocation, Link } from "react-router-dom";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { ChevronLeft, Home } from "lucide-react";
import { routeLabels, isUUID } from "@/lib/route-labels";

export function AppBreadcrumb() {
  const location = useLocation();
  const pathSegments = location.pathname.split("/").filter(Boolean);

  if (pathSegments.length === 0) return null;

  const crumbs: { label: string; path: string }[] = [];

  pathSegments.forEach((segment, index) => {
    if (isUUID(segment)) {
      crumbs.push({
        label: "تفاصيل",
        path: "/" + pathSegments.slice(0, index + 1).join("/"),
      });
    } else {
      const label = routeLabels[segment] || segment;
      crumbs.push({
        label,
        path: "/" + pathSegments.slice(0, index + 1).join("/"),
      });
    }
  });

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link
              to="/"
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <Home className="h-3.5 w-3.5" />
              <span className="sr-only">الرئيسية</span>
            </Link>
          </BreadcrumbLink>
        </BreadcrumbItem>

        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          // Segments that are not navigable (no index page exists for them)
          const nonNavigable = new Set(["/reports", "/inventory"]);
          const isNonNavigable = nonNavigable.has(crumb.path);
          return (
            <span key={crumb.path} className="contents">
              <BreadcrumbSeparator>
                <ChevronLeft className="h-3.5 w-3.5" />
              </BreadcrumbSeparator>
              <BreadcrumbItem>
                {isLast || isNonNavigable ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link to={crumb.path}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </span>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
