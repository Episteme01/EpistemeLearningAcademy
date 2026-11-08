import { initializeApp, deleteApp } from 'firebase/app';
import { createUserWithEmailAndPassword, getAuth, sendPasswordResetEmail, signOut, updateProfile } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { firebaseConfig } from '@/config/env';
import { C } from '@/config/collections';
import type { Role } from '@/config/permissions';
import { audit } from './audit';

export interface NewAccount {
  email: string;
  password: string;
  displayName: string;
  role: Role;
  phone?: string;
  studentId?: string;
  classId?: string;
  staffId?: string;
  parentId?: string;
  devOnly?: boolean;
  sendResetEmail?: boolean;
}

/**
 * Creates a Firebase Auth user WITHOUT signing the administrator out, using a
 * temporary secondary app instance (works on the free Spark plan — no Cloud
 * Function needed). The profile document is then written with the admin's own
 * session, so Firestore rules decide whether this admin may mint that role.
 */
export async function createAccount(acc: NewAccount): Promise<string> {
  const secondary = initializeApp(firebaseConfig as Record<string, string>, `secondary-${Date.now()}`);
  try {
    const sAuth = getAuth(secondary);
    const cred = await createUserWithEmailAndPassword(sAuth, acc.email.trim(), acc.password);
    await updateProfile(cred.user, { displayName: acc.displayName });
    const uid = cred.user.uid;
    // If the rules refuse the profile (e.g. an admin trying to mint a super_admin), this throws;
    // the orphan auth user has no profile and therefore no access to anything.
    {
      await setDoc(doc(db(), C.users, uid), {
        email: acc.email.trim().toLowerCase(),
        displayName: acc.displayName,
        role: acc.role,
        status: 'active',
        phone: acc.phone ?? '',
        studentId: acc.studentId ?? '',
        classId: acc.classId ?? '',
        staffId: acc.staffId ?? '',
        parentId: acc.parentId ?? '',
        devOnly: acc.devOnly ?? false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    if (acc.sendResetEmail) await sendPasswordResetEmail(sAuth, acc.email.trim()).catch(() => undefined);
    await signOut(sAuth);
    await audit('account.create', `users/${uid}`, `${acc.role}: ${acc.email}`);
    return uid;
  } finally {
    await deleteApp(secondary);
  }
}

export function randomPassword(length = 14): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  const buf = new Uint32Array(length);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join('');
}
