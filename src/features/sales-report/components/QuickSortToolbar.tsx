import type { SortingState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";

interface QuickSortToolbarProps {
  sorting: SortingState;
  setSorting: (sorting: SortingState) => void;
}

export function QuickSortToolbar({
  sorting,
  setSorting,
}: QuickSortToolbarProps) {
  const active = sorting[0];

  const toggle = (id: "profit" | "margin") => {
    if (active?.id !== id) setSorting([{ id, desc: true }]);
    else if (active.desc) setSorting([{ id, desc: false }]);
    else setSorting([]);
  };

  const renderButton = (id: "profit" | "margin", label: string) => {
    const isActive = active?.id === id;
    const Icon = isActive && !active.desc ? ArrowUp : ArrowDown;
    return (
      <Button
        key={id}
        variant={isActive ? "default" : "outline"}
        size="sm"
        className="h-8 gap-1 text-xs"
        onClick={() => toggle(id)}
      >
        <Icon className="h-3 w-3" />
        {label}
      </Button>
    );
  };

  return (
    <div className="flex items-center gap-1.5">
      {renderButton("profit", "الربح")}
      {renderButton("margin", "الهامش%")}
    </div>
  );
}
