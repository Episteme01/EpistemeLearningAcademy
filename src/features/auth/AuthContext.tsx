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
import type { Role } from '@/config/permissions';

type Status = 'loading' | 'signedOut' | 'ready' | 'noProfile' | 'inactive';

interface AuthState {
  status: Status;
  user: User | null;
  profile: UserProfile | null;
  role: Role | null;
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
    await signInWithEmailAndPassword(auth(), email.trim(), password);
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth());
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    await sendPasswordResetEmail(auth(), email.trim());
  }, []);

  const value = useMemo<AuthState>(
    () => ({ status, user, profile, role: status === 'ready' ? (profile?.role ?? null) : null, uid: user?.uid ?? null, login, logout, resetPassword }),
    [status, user, profile, login, logout, resetPassword],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
