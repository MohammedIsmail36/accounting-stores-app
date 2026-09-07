import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Round a number to N decimal places (default 2) — use for all financial calculations */
export function round2(value: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** Format a Date to "yyyy-MM-dd" string for DB/API usage */
export function toDateString(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/** Replace Arabic-Indic digits (٠-٩) with Western digits (0-9) */
export function toWesternDigits(str: string): string {
  return str.replace(/[\u0660-\u0669]/g, (c) =>
    String(c.charCodeAt(0) - 0x0660),
  );
}
