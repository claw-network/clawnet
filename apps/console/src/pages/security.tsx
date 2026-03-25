import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp';
import { api } from '@/lib/api';
import { ShieldCheck, ShieldOff, Loader2 } from 'lucide-react';

interface TotpStatus {
  configured: boolean;
  enabled: boolean;
}

export function SecurityPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disabling, setDisabling] = useState(false);
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [error, setError] = useState('');

  const fetchStatus = () => {
    setLoading(true);
    api
      .get<TotpStatus>('/auth/totp/status')
      .then((data) => setStatus(data))
      .catch(() => setStatus({ configured: false, enabled: false }))
      .finally(() => setLoading(false));
  };

  useEffect(fetchStatus, []);

  const handleDisable = async (e: FormEvent) => {
    e.preventDefault();
    if (disableCode.length !== 6) return;

    setDisabling(true);
    setError('');

    try {
      const result = await api.post<{ success: boolean; reason?: string }>(
        '/auth/totp/disable',
        { code: disableCode },
      );
      if (result.success) {
        setShowDisableConfirm(false);
        setDisableCode('');
        fetchStatus();
      } else {
        setError(result.reason || 'Invalid code');
        setDisableCode('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disable 2FA');
      setDisableCode('');
    } finally {
      setDisabling(false);
    }
  };

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (showDisableConfirm && disableCode.length === 6 && !disabling) {
      handleDisable({ preventDefault: () => {} } as FormEvent);
    }
  }, [disableCode]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Security</h2>
        <p className="text-muted-foreground">
          Manage two-factor authentication and security settings
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5" />
            Two-Factor Authentication
          </CardTitle>
          <CardDescription>
            Add an extra layer of security to your console with an authenticator app
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Checking status…
            </div>
          ) : status?.configured ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="flex size-2 rounded-full bg-emerald-500" />
                <span className="text-sm font-medium">2FA is enabled</span>
              </div>

              {showDisableConfirm ? (
                <form onSubmit={handleDisable} className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Enter your current authenticator code to disable 2FA:
                  </p>
                  <div className="flex justify-center">
                    <InputOTP
                      maxLength={6}
                      value={disableCode}
                      onChange={setDisableCode}
                      disabled={disabling}
                      autoFocus
                    >
                      <InputOTPGroup>
                        <InputOTPSlot index={0} />
                        <InputOTPSlot index={1} />
                        <InputOTPSlot index={2} />
                        <InputOTPSlot index={3} />
                        <InputOTPSlot index={4} />
                        <InputOTPSlot index={5} />
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      variant="destructive"
                      size="sm"
                      disabled={disabling || disableCode.length !== 6}
                    >
                      {disabling ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          Disabling…
                        </>
                      ) : (
                        'Confirm Disable'
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowDisableConfirm(false);
                        setDisableCode('');
                        setError('');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDisableConfirm(true)}
                >
                  <ShieldOff className="size-4" />
                  Disable 2FA
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="flex size-2 rounded-full bg-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  2FA is not configured
                </span>
              </div>
              <Button
                size="sm"
                onClick={() => navigate('/totp-setup')}
              >
                <ShieldCheck className="size-4" />
                Enable 2FA
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
