import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  verifyPassphrase,
  verifyTotp,
  setAuthenticated,
  setPendingToken,
  clearPendingToken,
} from '@/lib/auth';
import { KeyRound, ShieldCheck, Loader2 } from 'lucide-react';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '@/components/ui/input-otp';

export function LoginPage() {
  const navigate = useNavigate();
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 2FA state
  const [totpStep, setTotpStep] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [pendingToken, setPending] = useState('');
  const [pendingDid, setPendingDid] = useState('');

  const handlePassphrase = async (e: FormEvent) => {
    e.preventDefault();
    if (!passphrase.trim()) return;

    setLoading(true);
    setError('');

    try {
      const result = await verifyPassphrase(passphrase);
      if (result.valid && result.requireTotp && result.pendingToken && result.did) {
        // 2FA required — show TOTP input
        setPending(result.pendingToken);
        setPendingDid(result.did);
        setPendingToken(result.pendingToken);
        setTotpStep(true);
      } else if (result.valid && result.did && result.sessionToken) {
        setAuthenticated(result.did, result.sessionToken);
        navigate('/', { replace: true });
      } else {
        setError('Invalid passphrase. Please try again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleTotp = async (e: FormEvent) => {
    e.preventDefault();
    if (totpCode.length !== 6) return;

    setLoading(true);
    setError('');

    try {
      const result = await verifyTotp(totpCode, pendingToken);
      if (result.valid && result.sessionToken) {
        clearPendingToken();
        setAuthenticated(pendingDid, result.sessionToken);
        navigate('/', { replace: true });
      } else {
        setError('Invalid code. Please try again.');
        setTotpCode('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
      setTotpCode('');
    } finally {
      setLoading(false);
    }
  };

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (totpStep && totpCode.length === 6 && !loading) {
      handleTotp({ preventDefault: () => {} } as FormEvent);
    }
  }, [totpCode]);

  if (totpStep) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <form onSubmit={handleTotp} className="w-full">
          <Card className="mx-auto max-w-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-5" /> Two-Factor Authentication
              </CardTitle>
              <CardDescription>
                Enter the 6-digit code from your authenticator app to verify your identity.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {error && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Field>
                <FieldLabel htmlFor="totp-code">Verification code</FieldLabel>
                <InputOTP
                  id="totp-code"
                  maxLength={6}
                  value={totpCode}
                  onChange={setTotpCode}
                  disabled={loading}
                  autoFocus
                >
                  <InputOTPGroup className="*:data-[slot=input-otp-slot]:h-12 *:data-[slot=input-otp-slot]:w-11 *:data-[slot=input-otp-slot]:text-xl">
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                  </InputOTPGroup>
                  <InputOTPSeparator className="mx-2" />
                  <InputOTPGroup className="*:data-[slot=input-otp-slot]:h-12 *:data-[slot=input-otp-slot]:w-11 *:data-[slot=input-otp-slot]:text-xl">
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </Field>
            </CardContent>
            <CardFooter>
              <Field>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={loading || totpCode.length !== 6}
                >
                  {loading ? (
                    <><Loader2 className="size-4 animate-spin" /> Verifying…</>
                  ) : (
                    'Verify Code'
                  )}
                </Button>
                <div className="text-sm text-muted-foreground">
                  Wrong account?{' '}
                  <button
                    type="button"
                    className="underline underline-offset-4 transition-colors hover:text-primary"
                    onClick={() => {
                      setTotpStep(false);
                      setTotpCode('');
                      setPending('');
                      clearPendingToken();
                      setError('');
                    }}
                  >
                    Back to passphrase
                  </button>
                </div>
              </Field>
            </CardFooter>
          </Card>
        </form>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <form onSubmit={handlePassphrase}>
          <FieldGroup>
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <KeyRound className="size-5" />
              </div>
              <h1 className="text-xl font-bold">ClawNet Console</h1>
              <FieldDescription>
                Enter your node passphrase to unlock the console
              </FieldDescription>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Field>
              <FieldLabel htmlFor="passphrase">Passphrase</FieldLabel>
              <Input
                id="passphrase"
                type="password"
                placeholder="Enter CLAW_PASSPHRASE"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoFocus
                disabled={loading}
              />
            </Field>

            <Field>
              <Button
                type="submit"
                className="w-full"
                disabled={loading || !passphrase.trim()}
              >
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Verifying…
                  </>
                ) : (
                  'Unlock Console'
                )}
              </Button>
            </Field>
          </FieldGroup>
        </form>

        <FieldDescription className="px-6 text-center text-xs">
          The passphrase is the same one used to start the node via{' '}
          <code className="font-mono text-foreground">CLAW_PASSPHRASE</code> or{' '}
          <code className="font-mono text-foreground">--passphrase</code>.
        </FieldDescription>
      </div>
    </div>
  );
}
