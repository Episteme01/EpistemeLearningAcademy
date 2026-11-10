import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { BRAND } from '@/config/brand';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input } from '@/components/ui/form';
import { Spinner } from '@/components/ui/data';
import { useAuth } from './AuthContext';
import { errorMessage } from '@/lib/utils';
import { useSeo } from '@/hooks/useSeo';

export function LoginPage() {
  useSeo('Sign in');
  const { status, login, resetPassword, logout, user } = useAuth();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  if (status === 'loading') return <Spinner />;
  if (status === 'ready') return <Navigate to={loc.state?.from ?? '/app'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setInfo('');
    if (!email || !password) return setError('Enter your email or username, and your password.');
    setBusy(true);
    try { await login(email, password, remember); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  const forgot = async () => {
    setError(''); setInfo('');
    if (!email) return setError('Enter your email first, then press “Forgot password”.');
    if (!email.includes('@')) return setInfo('Students: ask your teacher or the school office to reset your password.');
    try { await resetPassword(email); } catch { /* do not reveal whether the account exists */ }
    setInfo('If an account exists for that email, a reset link has been sent.');
  };

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden bg-forest-700 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <img src={BRAND.logo} alt="" className="h-14 w-14 rounded bg-white p-1" />
        <div>
          <p className="font-heading text-3xl font-semibold leading-snug">{BRAND.motto}</p>
          <p className="mt-3 text-forest-200">{BRAND.philosophy.join(' + ')}</p>
        </div>
        <p className="text-sm text-forest-300">{BRAND.name} · {BRAND.location}</p>
      </div>
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Staff, parents and students use the same portal.</p>

          {(status === 'noProfile' || status === 'inactive') && user && (
            <div role="alert" className="mt-5 rounded-md border border-warn/30 bg-warn-bg p-4 text-sm text-warn">
              {status === 'inactive'
                ? 'Your account is not active. Please contact the school administrator.'
                : <>Your sign-in works, but no portal profile exists for it yet. Ask an administrator to activate it. Your user ID:
                  <code className="mt-1 block break-all rounded bg-white p-1.5 text-xs text-ink">{user.uid}</code></>}
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void logout()}>Sign out</Button>
            </div>
          )}

          <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-4" noValidate>
            <Field label="Email or student username" required>{(a) => <Input {...a} type="text" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
            <Field label="Password" required>{(a) => <Input {...a} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
            <div className="flex items-center justify-between">
              <Checkbox label="Keep me signed in" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <button type="button" onClick={() => void forgot()} className="text-sm text-forest-500 underline underline-offset-4">Forgot password?</button>
            </div>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            {info && <p role="status" className="text-sm text-ok">{info}</p>}
            <Button type="submit" className="w-full" loading={busy}>Sign in</Button>
          </form>
          <p className="mt-6 text-center text-sm text-muted"><Link to="/" className="underline underline-offset-4">← Back to website</Link></p>
        </div>
      </div>
    </main>
  );
}
