import React from "react";
import type { LucideIcon } from "lucide-react";

export interface DocumentStatItem {
  label: string;
  value: string;
  icon: LucideIcon;
  /** Tailwind classes for the icon bubble (semantic tokens only). */
  color: string;
  /** Status value applied when the card is clicked; "" makes it inert. */
  filter: string;
}

interface DocumentStatsStripProps {
  items: DocumentStatItem[];
  activeFilter: string;
  onFilterChange: (status: string) => void;
}

/** Clickable KPI strip shared by the document list screens. */
export function DocumentStatsStrip({
  items,
  activeFilter,
  onFilterChange,
}: DocumentStatsStripProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      {items.map(({ label, value, icon: Icon, color, filter }) => (
        <button
          key={label}
          type="button"
          onClick={() => filter && onFilterChange(filter)}
          className={`rounded-xl border p-4 text-right bg-card transition-all hover:shadow-md ${
            filter && activeFilter === filter ? "ring-2 ring-primary" : ""
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-2xl font-black text-foreground font-mono">{value}</span>
          </div>
          <p className="text-xs text-muted-foreground">{label}</p>
        </button>
      ))}
    </div>
  );
}
