import React from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePickerInput } from "@/components/DatePickerInput";
import {
  DATE_RANGE_PRESET_LABELS,
  type DateRangePreset,
} from "@/hooks/use-date-range-filter";
import { cn } from "@/lib/utils";

/** حاوية الفلاتر الموحّدة — صفوف مرنة بعروض ثابتة (النمط الحديث في النظام) */
export function FilterBar({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** حقل ضمن شريط الفلاتر بعنوان صغير وعرض ثابت */
export function FilterField({
  label,
  width = "w-44",
  className,
  children,
}: {
  label?: string;
  width?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1", width, className)}>
      {label && (
        <span className="text-[11px] text-muted-foreground leading-none">{label}</span>
      )}
      {children}
    </div>
  );
}

/** حقل بحث موحّد مع زر تفريغ */
export function FilterSearch({
  value,
  onChange,
  placeholder = "بحث...",
  width = "w-64",
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: string;
  label?: string;
}) {
  return (
    <FilterField label={label} width={width}>
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="pr-9 h-10"
        />
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute left-1 top-1/2 -translate-y-1/2 h-7 w-7"
            onClick={() => onChange("")}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </FilterField>
  );
}

const PRESETS: DateRangePreset[] = [
  "all",
  "today",
  "last7",
  "last30",
  "month",
  "quarter",
  "year",
  "custom",
];

/** مجموعة فلتر النطاق الزمني الموحّدة (نطاق جاهز + تاريخين للمخصص) */
export function FilterDateRange({
  preset,
  onPresetChange,
  dateFrom,
  dateTo,
  onFromChange,
  onToChange,
}: {
  preset: DateRangePreset;
  onPresetChange: (p: DateRangePreset) => void;
  dateFrom: string;
  dateTo: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}) {
  return (
    <>
      <FilterField label="الفترة" width="w-40">
        <Select value={preset} onValueChange={(v) => onPresetChange(v as DateRangePreset)}>
          <SelectTrigger className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESETS.map((p) => (
              <SelectItem key={p} value={p}>
                {DATE_RANGE_PRESET_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterField>

      {preset === "custom" && (
        <>
          <FilterField label="من تاريخ" width="w-40">
            <DatePickerInput value={dateFrom} onChange={onFromChange} />
          </FilterField>
          <FilterField label="إلى تاريخ" width="w-40">
            <DatePickerInput value={dateTo} onChange={onToChange} />
          </FilterField>
        </>
      )}
    </>
  );
}

const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "كل الحالات" },
  { value: "draft", label: "مسودة" },
  { value: "posted", label: "مُرحّل" },
  { value: "cancelled", label: "ملغي" },
];

/** فلتر الحالة الموحّد (مسودة / مُرحّل / ملغي) */
export function StatusFilterSelect({
  value,
  onChange,
  className = "w-32 h-9 text-sm",
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="الحالة" />
      </SelectTrigger>
      <SelectContent>
        {STATUS_FILTER_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
