import * as React from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
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

interface Account {
  id: string;
  code: string;
  name: string;
  account_type: string;
}

interface AccountComboboxProps {
  accounts: Account[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function AccountCombobox({
  accounts,
  value,
  onValueChange,
  placeholder = "اختر الحساب...",
  className,
  disabled = false,
}: AccountComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const selectedAccount = accounts.find((a) => a.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between h-9 font-normal text-sm shadow-xs transition-colors",
            "hover:bg-accent/50",
            !value && "text-muted-foreground",
            open && "ring-2 ring-ring/20 border-ring",
            className
          )}
        >
          <span className="truncate flex-1 text-right">
            {selectedAccount
              ? `${selectedAccount.code} - ${selectedAccount.name}`
              : placeholder}
          </span>
          <ChevronsUpDown className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0 shadow-lg border-border/80"
        align="start"
        sideOffset={5}
      >
        <Command dir="rtl" className="rounded-md">
          <CommandInput placeholder="ابحث بالرقم أو الاسم..." className="h-10 text-sm" />
          <CommandList>
            <CommandEmpty>
              <div className="flex flex-col items-center gap-1.5">
                <Search className="h-5 w-5 text-muted-foreground/40" />
                <span>لا توجد نتائج</span>
              </div>
            </CommandEmpty>
            <CommandGroup>
              {accounts.map((account) => (
                <CommandItem
                  key={account.id}
                  value={`${account.code} ${account.name}`}
                  onSelect={() => {
                    onValueChange(account.id === value ? "" : account.id);
                    setOpen(false);
                  }}
                  className="gap-2.5"
                >
                  <span className="inline-flex items-center justify-center min-w-[3rem] rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                    {account.code}
                  </span>
                  <span className="flex-1 truncate">{account.name}</span>
                  <Check
                    className={cn(
                      "mr-auto h-4 w-4 shrink-0 text-primary transition-opacity",
                      value === account.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
