import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { buildPageTitle } from "@/lib/route-labels";
import { useSettings } from "@/contexts/SettingsContext";

const FALLBACK_NAME = "نظام المحاسبة";

/**
 * Updates document.title based on the current route + company name from settings,
 * so each browser tab shows: "اسم الشاشة • اسم الشركة".
 */
export function usePageTitle(): string {
  const location = useLocation();
  const { settings } = useSettings();
  const pageTitle = buildPageTitle(location.pathname);
  const companyName = settings?.company_name?.trim() || FALLBACK_NAME;
  const fullTitle = `${pageTitle} - ${companyName}`;

  useEffect(() => {
    document.title = fullTitle;
  }, [fullTitle]);

  return fullTitle;
}
