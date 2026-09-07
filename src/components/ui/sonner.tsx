import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Unified Toaster — single source of truth for all notifications.
 * - Position: top-center, RTL, system font (Tajawal)
 * - Auto-dismiss: 3s (errors 4s via use-toast shim)
 * - richColors: vibrant semantic colors with built-in icons
 * - Light theme forced to match the app (no dark mode in this product)
 * - Visual polish handled in index.css under [data-sonner-toaster]
 */
const Toaster = (props: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      position="top-center"
      duration={3000}
      dir="rtl"
      richColors
      closeButton
      visibleToasts={3}
      gap={10}
      offset={20}
      style={
        {
          fontFamily:
            "'Tajawal', 'IBM Plex Sans Arabic', system-ui, -apple-system, 'Segoe UI', sans-serif",
          "--width": "380px",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
export { toast } from "sonner";
