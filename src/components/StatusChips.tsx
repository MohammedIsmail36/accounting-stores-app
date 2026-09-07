import { LucideIcon } from "lucide-react";

export interface StatusChip {
  label: string;
  value: number | string;
  filter: string;
  icon: LucideIcon;
  color: string; // tailwind classes for icon bg/text
}

interface Props {
  chips: StatusChip[];
  active: string;
  onSelect: (filter: string) => void;
}

/** Compact status chips row — sits below the KPI cards. */
export function StatusChips({ chips, active, onSelect }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map(({ label, value, filter, icon: Icon, color }) => {
        const isActive = active === filter;
        return (
          <button
            key={label}
            onClick={() => onSelect(filter)}
            className={`group inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium bg-card transition-all hover:shadow-sm ${
              isActive
                ? "ring-2 ring-primary border-primary/30"
                : "border-border"
            }`}
          >
            <span
              className={`w-5 h-5 rounded-full flex items-center justify-center ${color}`}
            >
              <Icon className="h-3 w-3" />
            </span>
            <span className="text-muted-foreground">{label}</span>
            <span className="font-mono font-bold text-foreground">{value}</span>
          </button>
        );
      })}
    </div>
  );
}
