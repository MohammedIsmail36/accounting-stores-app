import { useAuth } from "@/contexts/AuthContext";

type AppRole = "admin" | "accountant" | "sales";

interface RoleGuardProps {
  children: React.ReactNode;
  allowedRoles: AppRole[];
}

export function RoleGuard({ children, allowedRoles }: RoleGuardProps) {
  const { role } = useAuth();
  if (!role || !allowedRoles.includes(role)) return null;
  return <>{children}</>;
}
