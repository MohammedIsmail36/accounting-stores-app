import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const TEN_MIN = 10 * 60 * 1000;

export function useCompanySettingsQuery() {
  return useQuery({
    queryKey: ["company-settings"],
    staleTime: TEN_MIN,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_settings")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useInvalidateCompanySettings() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["company-settings"] });
}
