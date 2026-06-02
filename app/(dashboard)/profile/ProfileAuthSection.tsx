'use client';

import { useCallback, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { scorePasswordStrength, validatePassword } from '@/lib/auth/password';
import { authPasswordStrengthLabelClass } from '@/lib/auth/auth-ui-classes';
import type { UserAuthProvider } from '@/lib/repositories/users';

interface ProfileAuthSectionProps {
  authProvider: UserAuthProvider;
  onAuthProviderChange: (provider: UserAuthProvider) => void;
}

/**
 * Account sign-in method controls: connect or disconnect Google OAuth.
 * @param props - Current auth provider and callback when it changes locally.
 * @returns Sign-in method section for account settings.
 */
export function ProfileAuthSection({
  authProvider,
  onAuthProviderChange,
}: ProfileAuthSectionProps) {
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [disconnectLoading, setDisconnectLoading] = useState(false);

  const handleConnectGoogle = () => {
    window.location.href = '/api/auth/oauth/connect';
  };

  const resetDisconnectForm = useCallback(() => {
    setPassword('');
    setConfirmPassword('');
    setDisconnectError(null);
    setShowPassword(false);
    setShowConfirmPassword(false);
  }, []);

  const closeDisconnectModal = () => {
    setDisconnectOpen(false);
    resetDisconnectForm();
  };

  const handleDisconnectSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setDisconnectError(null);

    if (password !== confirmPassword) {
      setDisconnectError('Passwords do not match.');
      return;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      setDisconnectError(passwordError);
      return;
    }

    setDisconnectLoading(true);
    try {
      const res = await fetch('/api/auth/oauth/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password, confirmPassword }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) {
        setDisconnectError(data.error ?? 'Failed to disconnect Google sign-in.');
        return;
      }

      onAuthProviderChange('password');
      closeDisconnectModal();
    } catch {
      setDisconnectError('An unexpected error occurred. Please try again.');
    } finally {
      setDisconnectLoading(false);
    }
  };

  const passwordScore = scorePasswordStrength(password);

  return (
    <section className="mt-8 rounded-xl border border-border bg-background p-6">
      <h2 className="text-xl font-semibold text-foreground">Sign-in method</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {authProvider === 'google'
          ? 'You sign in with Google. Disconnect to use email and password instead.'
          : 'You sign in with email and password. Connect Google to sign in without a password.'}
      </p>

      <div className="mt-4">
        {authProvider === 'google' ? (
          <button
            type="button"
            onClick={() => {
              resetDisconnectForm();
              setDisconnectOpen(true);
            }}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Disconnect Google
          </button>
        ) : (
          <button
            type="button"
            onClick={handleConnectGoogle}
            className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Connect Google
          </button>
        )}
      </div>

      {disconnectOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDisconnectModal();
          }}
        >
          <div
            role="dialog"
            aria-labelledby="disconnect-google-title"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-lg"
          >
            <h3 id="disconnect-google-title" className="text-lg font-semibold text-foreground">
              Disconnect Google sign-in
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Choose a new password to sign in with email and password. Your Google account will be
              unlinked from VideoSphere.
            </p>

            <form onSubmit={handleDisconnectSubmit} className="mt-6 space-y-4">
              <div>
                <label
                  htmlFor="disconnect-password"
                  className="block text-sm font-medium text-foreground"
                >
                  New password
                </label>
                <div className="relative mt-2">
                  <input
                    id="disconnect-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full rounded-lg border border-border bg-background px-4 py-3 pr-10 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {password ? (
                  <p className={`mt-2 ${authPasswordStrengthLabelClass(passwordScore)}`}>
                    Strength: {['', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong'][passwordScore]}
                  </p>
                ) : null}
              </div>

              <div>
                <label
                  htmlFor="disconnect-confirm-password"
                  className="block text-sm font-medium text-foreground"
                >
                  Confirm password
                </label>
                <div className="relative mt-2">
                  <input
                    id="disconnect-confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="block w-full rounded-lg border border-border bg-background px-4 py-3 pr-10 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {disconnectError ? (
                <p className="text-sm text-destructive" role="alert">
                  {disconnectError}
                </p>
              ) : null}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeDisconnectModal}
                  disabled={disconnectLoading}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={disconnectLoading}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {disconnectLoading ? 'Disconnecting…' : 'Disconnect and set password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
