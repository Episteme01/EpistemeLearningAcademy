import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { Spinner } from '@/components/ui/data';
import type { Role } from '@/config/permissions';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const loc = useLocation();
  if (status === 'loading') return <Spinner className="min-h-screen" />;
  if (status !== 'ready') return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return <>{children}</>;
}

/** UI guard only — the real enforcement is in Firestore rules. */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { role } = useAuth();
  if (!role || !roles.includes(role)) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <h1 className="text-xl font-semibold">No access</h1>
        <p className="mt-2 text-sm text-muted">Your role does not include this area.</p>
      </div>
    );
  }
  return <>{children}</>;
}
