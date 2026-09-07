import React from "react";
import { Button } from "@/components/ui/button";
import { DatePickerInput } from "@/components/DatePickerInput";
import { StatusFilterSelect } from "@/components/FilterBar";
import { X } from "lucide-react";

interface DocumentListFiltersProps {
  dateFrom: string;
  onDateFromChange: (v: string) => void;
  dateTo: string;
  onDateToChange: (v: string) => void;
  hasFilters: boolean;
  onClear: () => void;
  /** Show the status dropdown (list screens without a status chip strip). */
  statusFilter?: string;
  onStatusChange?: (v: string) => void;
}

/** Date range + optional status filter toolbar shared by document lists. */
export function DocumentListFilters({
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  hasFilters,
  onClear,
  statusFilter,
  onStatusChange,
}: DocumentListFiltersProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {statusFilter !== undefined && onStatusChange && (
        <StatusFilterSelect value={statusFilter} onChange={onStatusChange} />
      )}
      <DatePickerInput
        value={dateFrom}
        onChange={onDateFromChange}
        placeholder="من تاريخ"
        className="w-[150px] h-9 text-sm"
      />
      <DatePickerInput
        value={dateTo}
        onChange={onDateToChange}
        placeholder="إلى تاريخ"
        className="w-[150px] h-9 text-sm"
      />
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="h-9 gap-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
          مسح الفلاتر
        </Button>
      )}
    </div>
  );
}
