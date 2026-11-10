import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence, browserSessionPersistence,
  sendPasswordResetEmail, type User,
} from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import { firebaseConfigured } from '@/config/env';
import { C } from '@/config/collections';
import type { UserProfile } from '@/types/models';
import { rolesOf, type Role } from '@/config/permissions';
import { setAuditActorRole } from '@/services/audit';
import { loginEmail } from '@/lib/studentLogin';

type Status = 'loading' | 'signedOut' | 'ready' | 'noProfile' | 'inactive';

interface AuthState {
  status: Status;
  user: User | null;
  profile: UserProfile | null;
  /** Active workspace role (UI scope). */
  role: Role | null;
  /** Every role assigned to this person (authoritative, from the server document). */
  roles: Role[];
  switchRole: (r: Role) => void;
  uid: string | null;
  login: (email: string, password: string, remember: boolean) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(firebaseConfigured ? 'loading' : 'signedOut');
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [chosen, setChosen] = useState<Role | null>(null);

  useEffect(() => {
    if (!firebaseConfigured) return;
    let unsubProfile: (() => void) | null = null;
    const unsubAuth = onAuthStateChanged(auth(), (u) => {
      unsubProfile?.();
      unsubProfile = null;
      setUser(u);
      if (!u) {
        setProfile(null);
        setStatus('signedOut');
        return;
      }
      setStatus('loading');
      // Role/status always come from the server document (rules also read it).
      unsubProfile = onSnapshot(
        doc(db(), C.users, u.uid),
        (snap) => {
          if (!snap.exists()) {
            setProfile(null);
            setStatus('noProfile');
            return;
          }
          const p = snap.data() as UserProfile;
          setProfile(p);
          setStatus(p.status === 'active' ? 'ready' : 'inactive');
        },
        () => {
          setProfile(null);
          setStatus('noProfile');
        },
      );
    });
    return () => {
      unsubProfile?.();
      unsubAuth();
    };
  }, []);

  const login = useCallback(async (email: string, password: string, remember: boolean) => {
    await setPersistence(auth(), remember ? browserLocalPersistence : browserSessionPersistence);
    await signInWithEmailAndPassword(auth(), loginEmail(email), password);
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth());
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    await sendPasswordResetEmail(auth(), email.trim());
  }, []);

  const roles = useMemo(() => (status === 'ready' ? rolesOf(profile) : []), [status, profile]);
  const uidNow = user?.uid ?? null;

  // Restore the last chosen workspace, but only if the server still grants it.
  useEffect(() => {
    if (!uidNow) { setChosen(null); return; }
    try { setChosen((localStorage.getItem(`ela.workspace.${uidNow}`) as Role | null) ?? null); } catch { setChosen(null); }
  }, [uidNow]);

  const role: Role | null = roles.length === 0 ? null : chosen && roles.includes(chosen) ? chosen : roles.includes(profile?.role as Role) ? (profile!.role as Role) : (roles[0] ?? null);
  useEffect(() => { setAuditActorRole(role); }, [role]);

  /** Switching changes the active workspace only. It does not create a new session and grants nothing. */
  const switchRole = useCallback((r: Role) => {
    if (!roles.includes(r)) return;
    setChosen(r);
    try { if (uidNow) localStorage.setItem(`ela.workspace.${uidNow}`, r); } catch { /* storage unavailable: choice lasts for this page only */ }
  }, [roles, uidNow]);

  const value = useMemo<AuthState>(
    () => ({ status, user, profile, role, roles, switchRole, uid: uidNow, login, logout, resetPassword }),
    [status, user, profile, role, roles, switchRole, uidNow, login, logout, resetPassword],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
