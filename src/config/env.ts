/**
 * Runtime configuration from Vite environment variables.
 * Firebase web config is read from either:
 *   VITE_FIREBASE_CONFIG_JSON  (single JSON string), or
 *   VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, ... (individual values)
 * No credentials are committed to the repository.
 */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
  measurementId?: string;
}

import fileConfig from './firebase-config.json';
import filesConfig from './files.json';

const env = import.meta.env;

function fromJson(): Partial<FirebaseWebConfig> | null {
  const raw = env.VITE_FIREBASE_CONFIG_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Partial<FirebaseWebConfig>;
  } catch {
    console.error('VITE_FIREBASE_CONFIG_JSON is not valid JSON.');
    return null;
  }
}

// Priority: VITE_FIREBASE_CONFIG_JSON variable > individual VITE_FIREBASE_* > src/config/firebase-config.json
const json = fromJson();
const file = fileConfig as Partial<FirebaseWebConfig>;

export const firebaseConfig: Partial<FirebaseWebConfig> = {
  apiKey: json?.apiKey ?? env.VITE_FIREBASE_API_KEY ?? file.apiKey,
  authDomain: json?.authDomain ?? env.VITE_FIREBASE_AUTH_DOMAIN ?? file.authDomain,
  projectId: json?.projectId ?? env.VITE_FIREBASE_PROJECT_ID ?? file.projectId,
  storageBucket: json?.storageBucket ?? env.VITE_FIREBASE_STORAGE_BUCKET ?? file.storageBucket,
  messagingSenderId: json?.messagingSenderId ?? env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? file.messagingSenderId,
  appId: json?.appId ?? env.VITE_FIREBASE_APP_ID ?? file.appId,
  measurementId: json?.measurementId ?? env.VITE_FIREBASE_MEASUREMENT_ID ?? file.measurementId,
};

export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

/** Public URL of the file gateway. Env var wins over src/config/files.json. */
export const filesGatewayUrl: string = ((env.VITE_FILES_GATEWAY_URL as string | undefined) ?? filesConfig.gatewayUrl ?? '').trim().replace(/\/+$/, '');

export const flags = {
  /** True when the file gateway (Supabase Edge Function) is configured. File uploads need it. */
  uploads: filesGatewayUrl !== '',
  /** Server-side CBT grading through Cloud Functions (Blaze plan) */
  functions: env.VITE_USE_CLOUD_FUNCTIONS === 'true',
};

export const SITE_URL = (env.VITE_SITE_URL as string | undefined) ?? (typeof window !== 'undefined' ? window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '') : '');
