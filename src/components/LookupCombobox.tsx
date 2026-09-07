import * as React from "react";
import { Check, ChevronsUpDown, Search, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface LookupItem {
  id: string;
  name: string;
  /** Display label (falls back to name). Use to show extra info like code. */
  label?: string;
  /** Extra keywords for search (won't show in display) */
  searchKeywords?: string;
  /** Structured search fields for smarter filtering */
  searchFields?: {
    code?: string;
    model?: string;
    brand?: string;
    name?: string;
    barcode?: string;
  };
}

export interface LookupComboboxProps {
  items: LookupItem[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
  disabled?: boolean;
  error?: boolean;
  /** When provided, shows a footer button "+ Add new" inside the popover.
   *  Receives the current search text so callers can prefill a quick-add dialog. */
  onAddNew?: (currentSearch: string) => void;
  /** Label for the "Add new" button (default: "إضافة جديد") */
  addNewLabel?: string;
}

/**
 * Custom filter: if item has searchFields, match each field independently.
 * A term must match at least one field. Multiple terms must all match.
 * This prevents "model 327" from matching items where "327" only appears
 * in the combined string but not in the relevant field.
 */
/** Fields where we match from the start (prefix) vs anywhere (substring) */
const PREFIX_FIELDS = new Set(["model"]);
/** Fields excluded from search filtering (kept for display only) */
const EXCLUDED_SEARCH_FIELDS = new Set(["barcode"]);

function smartFilter(
  itemValue: string,
  search: string,
  keywords?: string[],
): number {
  // keywords[0] contains JSON-encoded searchFields if available
  if (keywords?.[0]) {
    try {
      const fields = JSON.parse(keywords[0]) as Record<string, string>;
      const terms = search.toLowerCase().trim().split(/\s+/);
      const entries = Object.entries(fields).filter(
        ([k, v]) => Boolean(v) && !EXCLUDED_SEARCH_FIELDS.has(k),
      );

      let matchCount = 0;
      for (const term of terms) {
        const matched = entries.some(([key, val]) => {
          const v = val.toLowerCase();
          // Code, model, barcode: prefix match only
          if (PREFIX_FIELDS.has(key)) return v.startsWith(term);
          // Name, brand: substring match
          return v.includes(term);
        });
        if (!matched) return 0;
        matchCount++;
      }
      return matchCount / terms.length;
    } catch {
      // fallback to default
    }
  }

  // Default cmdk-like behavior
  const val = itemValue.toLowerCase();
  const s = search.toLowerCase().trim();
  if (!s) return 1;
  return val.includes(s) ? 1 : 0;
}

export function LookupCombobox({
  items,
  value,
  onValueChange,
  placeholder = "اختر...",
  searchPlaceholder = "ابحث...",
  emptyMessage = "لا توجد نتائج.",
  className,
  disabled = false,
  error = false,
  onAddNew,
  addNewLabel = "إضافة جديد",
}: LookupComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [searchValue, setSearchValue] = React.useState("");
  const selected = items.find((i) => i.id === value);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  // Handle Tab key to select highlighted item and close
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Tab" && open) {
        // Find the currently highlighted [data-selected=true] item
        const container = (e.target as HTMLElement).closest("[cmdk-root]");
        const selectedEl = container?.querySelector(
          "[cmdk-item][data-selected=true]",
        );
        if (selectedEl) {
          // Trigger click on the selected item
          (selectedEl as HTMLElement).click();
        }
        // Don't prevent default - let Tab naturally move focus to next field
      }
    },
    [open],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between h-9 font-normal text-sm shadow-xs transition-colors",
            "hover:bg-accent/50",
            !value && "text-muted-foreground",
            open && "ring-2 ring-ring/20 border-ring",
            error && "border-red-500",
            className,
          )}
        >
          <span className="truncate flex-1 text-right">
            {selected ? (selected.label ?? selected.name) : placeholder}
          </span>
          <ChevronsUpDown className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0 shadow-lg border-border/80"
        align="start"
        side="bottom"
        avoidCollisions={false}
        sideOffset={5}
        onOpenAutoFocus={(e) => {
          // Let command input auto-focus
        }}
      >
        <Command dir="rtl" className="rounded-md" filter={smartFilter}>
          <div onKeyDown={handleKeyDown}>
            <CommandInput
              placeholder={searchPlaceholder}
              className="h-10 text-sm"
              value={searchValue}
              onValueChange={setSearchValue}
            />
          </div>
          <CommandList>
            <CommandEmpty>
              <div className="flex flex-col items-center gap-1.5 py-2">
                <Search className="h-5 w-5 text-muted-foreground/40" />
                <span>{emptyMessage}</span>
                {onAddNew && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-1 h-8 text-primary hover:text-primary"
                    onClick={() => {
                      setOpen(false);
                      onAddNew(searchValue);
                    }}
                  >
                    <Plus className="ml-1 h-4 w-4" />
                    {addNewLabel}
                    {searchValue ? `: "${searchValue}"` : ""}
                  </Button>
                )}
              </div>
            </CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={
                    item.searchKeywords
                      ? `${item.name} ${item.searchKeywords}`
                      : item.name
                  }
                  keywords={
                    item.searchFields
                      ? [JSON.stringify(item.searchFields)]
                      : undefined
                  }
                  onSelect={() => {
                    onValueChange(item.id === value ? "" : item.id);
                    setOpen(false);
                  }}
                >
                  <span className="flex-1 truncate">{item.label ?? item.name}</span>
                  <Check
                    className={cn(
                      "mr-auto h-4 w-4 shrink-0 text-primary transition-opacity",
                      value === item.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
            {onAddNew && items.length > 0 && (
              <div className="border-t p-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start h-8 text-primary hover:text-primary hover:bg-primary/5"
                  onClick={() => {
                    setOpen(false);
                    onAddNew(searchValue);
                  }}
                >
                  <Plus className="ml-1 h-4 w-4" />
                  {addNewLabel}
                </Button>
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
