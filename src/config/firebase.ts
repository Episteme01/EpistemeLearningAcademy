import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { firebaseConfig, firebaseConfigured } from './env';

let _app: FirebaseApp | null = null;
let _db: Firestore | null = null;

function requireConfigured() {
  if (!firebaseConfigured) {
    throw new Error('Firebase is not configured. Set the VITE_FIREBASE_* variables (see README).');
  }
}

export function fbApp(): FirebaseApp {
  requireConfigured();
  if (!_app) _app = getApps().length ? getApp() : initializeApp(firebaseConfig as Record<string, string>);
  return _app;
}

export function auth(): Auth {
  return getAuth(fbApp());
}

export function db(): Firestore {
  if (_db) return _db;
  const app = fbApp();
  try {
    // Offline cache helps on unreliable mobile connections. Security is still
    // enforced by the server (rules, timing) — the cache never grants access.
    _db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    _db = getFirestore(app);
  }
  return _db;
}

