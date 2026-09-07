import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User, Session } from "@supabase/supabase-js";

type AppRole = "admin" | "accountant" | "sales";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  roleLoading: boolean;
  fullName: string;
  loading: boolean;
  mfaRequired: boolean;
  signOut: () => Promise<void>;
}


const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  role: null,
  roleLoading: false,
  fullName: "",
  loading: true,
  mfaRequired: false,
  signOut: async () => {},
});


export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [mfaRequired, setMfaRequired] = useState(false);

  // Cached role + profile via React Query (deduplicated across components)
  const { data: role = null, isLoading: roleQueryLoading } = useQuery({
    queryKey: ["user-role", user?.id],
    enabled: !!user?.id,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;
      return (data?.role ?? null) as AppRole | null;
    },
  });
  const roleLoading = !!user?.id && roleQueryLoading;


  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user?.id,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user!.id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const fullName = profile?.full_name || "";

  const checkMfaStatus = async () => {
    try {
      const { data: aalData } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalData) {
        setMfaRequired(
          aalData.currentLevel === "aal1" && aalData.nextLevel === "aal2",
        );
      }
    } catch (err) {
      console.error("Error checking MFA status:", err);
      setMfaRequired(true);
    }
  };

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        setTimeout(() => {
          checkMfaStatus();
        }, 0);
      } else {
        setMfaRequired(false);
        // Clear cached user data on sign-out
        queryClient.removeQueries({ queryKey: ["user-role"] });
        queryClient.removeQueries({ queryKey: ["profile"] });
      }
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) checkMfaStatus();
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [queryClient]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setMfaRequired(false);
    queryClient.clear();
  };

  return (
    <AuthContext.Provider
      value={{ user, session, role, roleLoading, fullName, loading, mfaRequired, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}
