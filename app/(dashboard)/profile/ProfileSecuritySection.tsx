'use client';

import { useCallback, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { scorePasswordStrength, validatePassword } from '@/lib/auth/password';
import { authPasswordStrengthLabelClass } from '@/lib/auth/auth-ui-classes';

type SecurityTab = 'password' | 'totp';
type TotpSetupStep = 'idle' | 'qr' | 'verify';

interface ProfileSecuritySectionProps {
  userEmail: string;
  totpEnabled: boolean;
  onTotpEnabledChange: (enabled: boolean) => void;
}

const INPUT_CLASS =
  'block w-full rounded-lg border border-border bg-background px-4 py-3 pr-10 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

const TAB_BUTTON_CLASS =
  'rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50';

const PASSWORD_TAB_ID = 'profile-security-tab-password';
const TOTP_TAB_ID = 'profile-security-tab-totp';
const PASSWORD_PANEL_ID = 'profile-security-panel-password';
const TOTP_PANEL_ID = 'profile-security-panel-totp';

/**
 * Security settings for password-based accounts: change password and TOTP 2FA.
 * @param props - User email and TOTP status callbacks.
 * @returns Security card with tabbed password and two-factor controls.
 */
export function ProfileSecuritySection({
  userEmail,
  totpEnabled,
  onTotpEnabledChange,
}: ProfileSecuritySectionProps) {
  const [activeTab, setActiveTab] = useState<SecurityTab>('password');

  return (
    <section className="mt-8 rounded-xl border border-border bg-background p-6">
      <h2 className="text-xl font-semibold text-foreground">Security</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Manage your password and two-factor authentication settings.
      </p>

      <div
        className="mt-6 flex flex-wrap gap-2 border-b border-border pb-4"
        role="tablist"
        aria-label="Security settings"
      >
        <button
          type="button"
          role="tab"
          id={PASSWORD_TAB_ID}
          aria-selected={activeTab === 'password'}
          aria-controls={PASSWORD_PANEL_ID}
          onClick={() => setActiveTab('password')}
          className={`${TAB_BUTTON_CLASS} ${
            activeTab === 'password'
              ? 'bg-primary text-primary-foreground'
              : 'border border-border text-foreground hover:bg-muted'
          }`}
        >
          Change Password
        </button>
        <button
          type="button"
          role="tab"
          id={TOTP_TAB_ID}
          aria-selected={activeTab === 'totp'}
          aria-controls={TOTP_PANEL_ID}
          onClick={() => setActiveTab('totp')}
          className={`${TAB_BUTTON_CLASS} ${
            activeTab === 'totp'
              ? 'bg-primary text-primary-foreground'
              : 'border border-border text-foreground hover:bg-muted'
          }`}
        >
          Two-Factor Auth
        </button>
      </div>

      <div className="mt-6">
        {activeTab === 'password' ? (
          <div role="tabpanel" id={PASSWORD_PANEL_ID} aria-labelledby={PASSWORD_TAB_ID}>
            <ChangePasswordPanel />
          </div>
        ) : (
          <div role="tabpanel" id={TOTP_PANEL_ID} aria-labelledby={TOTP_TAB_ID}>
            <TotpPanel
              userEmail={userEmail}
              totpEnabled={totpEnabled}
              onTotpEnabledChange={onTotpEnabledChange}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function ChangePasswordPanel() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const newPasswordScore = scorePasswordStrength(newPassword);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) {
        setError(data.error ?? 'Failed to change password.');
        return;
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Password changed successfully.');
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-md space-y-4">
      <PasswordField
        id="change-current-password"
        label="Current password"
        autoComplete="current-password"
        value={currentPassword}
        onChange={setCurrentPassword}
        show={showCurrentPassword}
        onToggleShow={() => setShowCurrentPassword((v) => !v)}
      />

      <div>
        <PasswordField
          id="change-new-password"
          label="New password"
          autoComplete="new-password"
          value={newPassword}
          onChange={setNewPassword}
          show={showNewPassword}
          onToggleShow={() => setShowNewPassword((v) => !v)}
        />
        {newPassword ? (
          <p className={`mt-2 ${authPasswordStrengthLabelClass(newPasswordScore)}`}>
            Strength: {['', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong'][newPasswordScore]}
          </p>
        ) : null}
      </div>

      <PasswordField
        id="change-confirm-password"
        label="Confirm new password"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        show={showConfirmPassword}
        onToggleShow={() => setShowConfirmPassword((v) => !v)}
      />

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? 'Updating…' : 'Update password'}
      </button>
    </form>
  );
}

interface PasswordFieldProps {
  id: string;
  label: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggleShow: () => void;
}

function PasswordField({
  id,
  label,
  autoComplete,
  value,
  onChange,
  show,
  onToggleShow,
}: PasswordFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="relative mt-2">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={INPUT_CLASS}
        />
        <button
          type="button"
          onClick={onToggleShow}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

interface TotpPanelProps {
  userEmail: string;
  totpEnabled: boolean;
  onTotpEnabledChange: (enabled: boolean) => void;
}

function TotpPanel({ userEmail, totpEnabled, onTotpEnabledChange }: TotpPanelProps) {
  const [setupStep, setSetupStep] = useState<TotpSetupStep>('idle');
  const [pendingSecret, setPendingSecret] = useState('');
  const [otpauthUri, setOtpauthUri] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [disableError, setDisableError] = useState<string | null>(null);
  const [disableLoading, setDisableLoading] = useState(false);

  const resetSetup = useCallback(() => {
    setSetupStep('idle');
    setPendingSecret('');
    setOtpauthUri('');
    setVerifyCode('');
    setError(null);
  }, []);

  const handleStartSetup = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/totp/setup/start', {
        method: 'POST',
        credentials: 'include',
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        secret?: string;
        otpauthUri?: string;
      };

      if (!res.ok || !data.secret || !data.otpauthUri) {
        setError(data.error ?? 'Failed to start two-factor setup.');
        return;
      }

      setPendingSecret(data.secret);
      setOtpauthUri(data.otpauthUri);
      setSetupStep('qr');
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifySetup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/totp/setup/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ secret: pendingSecret, token: verifyCode }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) {
        setError(data.error ?? 'Failed to verify authentication code.');
        return;
      }

      onTotpEnabledChange(true);
      resetSetup();
      toast.success('Two-factor authentication enabled.');
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDisableSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setDisableError(null);
    setDisableLoading(true);
    try {
      const res = await fetch('/api/auth/totp/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token: disableCode }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) {
        setDisableError(data.error ?? 'Failed to disable two-factor authentication.');
        return;
      }

      onTotpEnabledChange(false);
      setDisableOpen(false);
      setDisableCode('');
      toast.success('Two-factor authentication disabled.');
    } catch {
      setDisableError('An unexpected error occurred. Please try again.');
    } finally {
      setDisableLoading(false);
    }
  };

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(pendingSecret);
      toast.success('Secret copied to clipboard.');
    } catch {
      toast.error('Could not copy secret. Please copy it manually.');
    }
  };

  if (totpEnabled && setupStep === 'idle') {
    return (
      <>
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800 dark:bg-green-900/40 dark:text-green-300">
            Two-factor authentication is active
          </span>
          <button
            type="button"
            onClick={() => {
              setDisableCode('');
              setDisableError(null);
              setDisableOpen(true);
            }}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Disable 2FA
          </button>
        </div>

        <Dialog
          open={disableOpen}
          onOpenChange={(open) => {
            if (!open && !disableLoading) {
              setDisableOpen(false);
              setDisableCode('');
              setDisableError(null);
            }
          }}
        >
          <DialogContent
            className="max-w-md"
            onPointerDownOutside={(event) => {
              if (disableLoading) event.preventDefault();
            }}
            onEscapeKeyDown={(event) => {
              if (disableLoading) event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>Disable two-factor authentication</DialogTitle>
              <DialogDescription>
                Enter the 6-digit code from your authenticator app to confirm.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleDisableSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="disable-totp-code"
                  className="block text-sm font-medium text-foreground"
                >
                  Authentication code
                </label>
                <input
                  id="disable-totp-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="mt-2 block w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {disableError ? (
                <p className="text-sm text-destructive" role="alert">
                  {disableError}
                </p>
              ) : null}

              <DialogFooter className="gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setDisableOpen(false)}
                  disabled={disableLoading}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={disableLoading || disableCode.length !== 6}
                  className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
                >
                  {disableLoading ? 'Disabling…' : 'Disable 2FA'}
                </button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  if (setupStep === 'qr') {
    return (
      <div className="max-w-md space-y-4">
        <p className="text-sm text-muted-foreground">
          Scan this QR code with your authenticator app, or enter the secret manually.
        </p>
        <div className="inline-block rounded-lg border border-border bg-white p-4">
          <QRCodeSVG value={otpauthUri} size={192} />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Manual entry secret</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground">
              {pendingSecret}
            </code>
            <button
              type="button"
              onClick={copySecret}
              className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Copy
            </button>
          </div>
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={resetSetup}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => setSetupStep('verify')}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Next
          </button>
        </div>
      </div>
    );
  }

  if (setupStep === 'verify') {
    return (
      <form onSubmit={handleVerifySetup} className="max-w-md space-y-4">
        <p className="text-sm text-muted-foreground">
          Enter the 6-digit code from your authenticator app for {userEmail}.
        </p>
        <div>
          <label htmlFor="setup-totp-code" className="block text-sm font-medium text-foreground">
            Authentication code
          </label>
          <input
            id="setup-totp-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={verifyCode}
            onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="mt-2 block w-full rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setSetupStep('qr')}
            disabled={loading}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            Back
          </button>
          <button
            type="submit"
            disabled={loading || verifyCode.length !== 6}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? 'Verifying…' : 'Verify and enable'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="max-w-md space-y-4">
      <p className="text-sm text-muted-foreground">
        Add an extra layer of security by requiring a code from your authenticator app at sign-in.
      </p>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={handleStartSetup}
        disabled={loading}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? 'Starting…' : 'Enable two-factor authentication'}
      </button>
    </div>
  );
}
