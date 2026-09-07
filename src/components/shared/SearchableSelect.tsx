import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: (SearchableSelectOption | string)[];
  /** Label for the "all" option (kept pinned at the top). Pass null to hide it. */
  allLabel?: string | null;
  allValue?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * قائمة منسدلة قابلة للبحث (Popover + Command) بنفس أحجام Select القياسي.
 * تُستخدم في فلاتر التقارير (الفئة / الماركة / المورد) لتفادي التمرير اليدوي على قوائم طويلة.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  allLabel = "الكل",
  allValue = "all",
  placeholder = "اختر...",
  searchPlaceholder = "بحث...",
  emptyMessage = "لا نتائج",
  className,
  disabled,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);

  const items = useMemo<SearchableSelectOption[]>(
    () =>
      options.map((o) =>
        typeof o === "string" ? { value: o, label: o } : o,
      ),
    [options],
  );

  const selectedLabel =
    value === allValue
      ? (allLabel ?? placeholder)
      : (items.find((o) => o.value === value)?.label ?? placeholder);

  const select = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-9 justify-between font-normal px-3",
            value === allValue && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[240px]" align="start" dir="rtl">
        <Command
          filter={(itemValue, search) =>
            itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput placeholder={searchPlaceholder} className="h-9" />
          <CommandList className="max-h-[240px]">
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {allLabel !== null && (
                <CommandItem value={allLabel} onSelect={() => select(allValue)}>
                  <Check
                    className={cn(
                      "ml-auto h-4 w-4",
                      value === allValue ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {allLabel}
                </CommandItem>
              )}
              {items.map((o) => (
                <CommandItem key={o.value} value={o.label} onSelect={() => select(o.value)}>
                  <Check
                    className={cn(
                      "ml-auto h-4 w-4",
                      value === o.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
