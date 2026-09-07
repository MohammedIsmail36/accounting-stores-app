import { Skeleton } from "@/components/ui/skeleton";

interface PageSkeletonProps {
  /** "table" = header + table rows, "form" = header + form fields, "cards" = header + cards grid */
  variant?: "table" | "form" | "cards";
}

export function PageSkeleton({ variant = "table" }: PageSkeletonProps) {
  return (
    <div className="space-y-6 animate-in fade-in duration-300" dir="rtl">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>

      {variant === "table" && <TableSkeleton />}
      {variant === "form" && <FormSkeleton />}
      {variant === "cards" && <CardsSkeleton />}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="border rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 p-4 border-b">
        <Skeleton className="h-9 w-48 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      {/* Header row */}
      <div className="flex items-center gap-4 px-4 py-3 bg-muted/20 border-b">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton
            key={i}
            className="h-4"
            style={{ width: `${[15, 25, 20, 15, 10][i - 1]}%` }}
          />
        ))}
      </div>
      {/* Data rows */}
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 px-4 py-3 border-b last:border-0"
        >
          {[1, 2, 3, 4, 5].map((j) => (
            <Skeleton
              key={j}
              className="h-4"
              style={{ width: `${[15, 25, 20, 15, 10][j - 1]}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="border rounded-xl p-6 space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    </div>
  );
}

function CardsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="border rounded-xl p-5 space-y-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-3 w-36" />
        </div>
      ))}
    </div>
  );
}
