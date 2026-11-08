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

const json = fromJson();

export const firebaseConfig: Partial<FirebaseWebConfig> = {
  apiKey: json?.apiKey ?? env.VITE_FIREBASE_API_KEY,
  authDomain: json?.authDomain ?? env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: json?.projectId ?? env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: json?.storageBucket ?? env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: json?.messagingSenderId ?? env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: json?.appId ?? env.VITE_FIREBASE_APP_ID,
  measurementId: json?.measurementId ?? env.VITE_FIREBASE_MEASUREMENT_ID,
};

export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

export const flags = {
  /** Cloud Storage for Firebase (may require the Blaze plan) */
  storage: env.VITE_ENABLE_STORAGE !== 'false',
  /** Server-side CBT grading through Cloud Functions (Blaze plan) */
  functions: env.VITE_USE_CLOUD_FUNCTIONS === 'true',
};

export const SITE_URL = (env.VITE_SITE_URL as string | undefined) ?? (typeof window !== 'undefined' ? window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '') : '');
