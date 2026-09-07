import { Navigate } from "react-router-dom";
import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/contexts/AuthContext";
import Forbidden from "@/pages/Forbidden";
type AppRole = "admin" | "accountant" | "sales";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: AppRole[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, role, loading, roleLoading, mfaRequired } = useAuth();

  // Wait for both the session AND (when role-gating is required) the role query
  // to settle, otherwise a brief 403 flashes on every reload because `role`
  // is still null while the user_roles query is in-flight.
  const waitingForRole = !!allowedRoles && !!user && roleLoading;

  if (loading || waitingForRole) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingState variant="inline" className="h-8 w-8" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // If MFA is enrolled but not yet verified for this session, redirect to MFA verification
  if (mfaRequired) {
    return <Navigate to="/auth/mfa" replace />;
  }

  if (allowedRoles && (!role || !allowedRoles.includes(role))) {
    return <Forbidden />;
  }

  return <>{children}</>;
}
