import { BRAND } from '@/config/brand';

export function SetupScreen() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-12">
      <img src={BRAND.logo} alt="" className="mb-6 h-16 w-16" />
      <h1 className="text-2xl font-semibold">Firebase is not configured yet</h1>
      <p className="mt-3 text-muted">
        The site is built, but it cannot reach your Firebase project. Add your Firebase web config as GitHub Actions
        <strong> Variables</strong> (or a local <code>.env</code> file) and rebuild.
      </p>
      <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm">
        <li>Firebase console → Project settings → Your apps → Web app → copy the SDK config.</li>
        <li>GitHub repo → Settings → Secrets and variables → Actions → Variables → add <code>VITE_FIREBASE_CONFIG_JSON</code> with the config as one JSON object.</li>
        <li>Actions → “Deploy to GitHub Pages” → Run workflow.</li>
      </ol>
      <p className="mt-5 text-sm text-muted">Full steps are in README.md (mobile-friendly). Questions: {BRAND.email}</p>
    </main>
  );
}
