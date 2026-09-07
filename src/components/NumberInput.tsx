import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toWesternDigits } from "@/lib/utils";

export interface NumberInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type"> {
  value: number | string;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Allow decimal values (default true). If false, only integers are accepted. */
  allowDecimal?: boolean;
}

/**
 * Numeric input that:
 * - Removes browser spinner arrows (no accidental ±)
 * - Disables mouse-wheel value changes (no accidental scroll changes)
 * - Preserves the user's literal text while typing (no rounding/jumping)
 * - Emits a parsed number to the parent only on valid input
 */
export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  (
    {
      value,
      onValueChange,
      min,
      max,
      allowDecimal = true,
      className,
      onBlur,
      onWheel,
      ...rest
    },
    ref,
  ) => {
    const [text, setText] = React.useState<string>(
      value === 0 || value === "0" ? "0" : value === "" || value == null ? "" : String(value),
    );

    // Sync external numeric changes (e.g. when product is selected and price auto-fills)
    React.useEffect(() => {
      const incoming = value === "" || value == null ? "" : String(value);
      // Avoid clobbering an in-progress edit like "12." or "1.20"
      const parsed = parseFloat(text);
      if (!isNaN(parsed) && parsed === Number(value)) return;
      setText(incoming);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = toWesternDigits(e.target.value).replace(/,/g, ".");
      // Only digits, optional single dot, optional leading minus (if min < 0)
      const pattern = allowDecimal
        ? min !== undefined && min < 0
          ? /^-?\d*\.?\d*$/
          : /^\d*\.?\d*$/
        : min !== undefined && min < 0
          ? /^-?\d*$/
          : /^\d*$/;
      if (raw !== "" && !pattern.test(raw)) return;
      setText(raw);
      if (raw === "" || raw === "-" || raw === ".") {
        onValueChange(0);
        return;
      }
      const num = parseFloat(raw);
      if (!isNaN(num)) onValueChange(num);
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      // Normalize on blur: clamp & strip trailing dot
      let num = parseFloat(text);
      if (isNaN(num)) num = 0;
      if (min !== undefined && num < min) num = min;
      if (max !== undefined && num > max) num = max;
      setText(num === 0 && text === "" ? "" : String(num));
      onValueChange(num);
      onBlur?.(e);
    };

    return (
      <Input
        {...rest}
        ref={ref}
        type="text"
        inputMode={allowDecimal ? "decimal" : "numeric"}
        value={text}
        onChange={handleChange}
        onBlur={handleBlur}
        onWheel={(e) => {
          // Prevent accidental value changes via mouse wheel
          (e.target as HTMLInputElement).blur();
          onWheel?.(e);
        }}
        className={cn(
          // Hide native spinner arrows in case browsers ever show them
          "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
          className,
        )}
      />
    );
  },
);
NumberInput.displayName = "NumberInput";
