import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '@/components/ui/input-otp';
import { api } from '@/lib/api';
import { ShieldCheck, Loader2, Copy, Check, X } from 'lucide-react';

interface SetupResponse {
  secret: string;
  otpauthUri: string;
}

interface VerifySetupResponse {
  success: boolean;
}

export function TotpSetupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'loading' | 'scan' | 'verify'>('loading');
  const [secret, setSecret] = useState('');
  const [otpauthUri, setOtpauthUri] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .post<SetupResponse>('/auth/totp/setup')
      .then((data) => {
        setSecret(data.secret);
        setOtpauthUri(data.otpauthUri);
        setStep('scan');
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to generate secret');
      });
  }, []);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleVerify = async (e: FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return;

    setLoading(true);
    setError('');

    try {
      const result = await api.post<VerifySetupResponse>('/auth/totp/verify-setup', {
        secret,
        code,
      });
      if (result.success) {
        navigate('/', { replace: true });
      } else {
        setError('Invalid code. Please try again.');
        setCode('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (step === 'verify' && code.length === 6 && !loading) {
      handleVerify({ preventDefault: () => {} } as FormEvent);
    }
  }, [code]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={() => navigate(-1)}
            title="Close"
          >
            <X className="size-4" />
          </Button>
        </div>
        <FieldGroup>
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <ShieldCheck className="size-5" />
            </div>
            <h1 className="text-xl font-bold">Set Up Two-Factor Authentication</h1>
            <FieldDescription>
              Protect your console with an authenticator app
            </FieldDescription>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {step === 'loading' && !error && (
            <div className="flex justify-center py-8">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {step === 'scan' && (
            <>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground text-center">
                  Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
                </p>

                <div className="flex justify-center rounded-lg bg-white p-4">
                  <QRCodeSVG value={otpauthUri} size={200} />
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground text-center">
                    Or enter this key manually:
                  </p>
                  <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
                    <code className="flex-1 break-all text-xs font-mono">{secret}</code>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 shrink-0"
                      onClick={handleCopy}
                    >
                      {copied ? (
                        <Check className="size-3.5" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              <Field>
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => setStep('verify')}
                >
                  I've scanned the code
                </Button>
              </Field>
            </>
          )}

          {step === 'verify' && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="size-5" /> Confirm Setup
                </CardTitle>
                <CardDescription>
                  Enter the 6-digit code from your authenticator app to complete 2FA setup.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {error && (
                  <Alert variant="destructive" className="mb-4">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <form onSubmit={handleVerify}>
                  <Field>
                    <FieldLabel htmlFor="setup-otp">Verification code</FieldLabel>
                    <InputOTP
                      id="setup-otp"
                      maxLength={6}
                      value={code}
                      onChange={setCode}
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
                </form>
              </CardContent>
              <CardFooter>
                <Field>
                  <Button
                    type="button"
                    className="w-full"
                    disabled={loading || code.length !== 6}
                    onClick={(e) => handleVerify(e as unknown as FormEvent)}
                  >
                    {loading ? (
                      <><Loader2 className="size-4 animate-spin" /> Verifying…</>
                    ) : (
                      'Confirm & Enable 2FA'
                    )}
                  </Button>
                  <div className="text-sm text-muted-foreground">
                    Need to re-scan?{' '}
                    <button
                      type="button"
                      className="underline underline-offset-4 transition-colors hover:text-primary"
                      onClick={() => { setStep('scan'); setCode(''); setError(''); }}
                    >
                      Back to QR code
                    </button>
                  </div>
                </Field>
              </CardFooter>
            </Card>
          )}
        </FieldGroup>
      </div>
    </div>
  );
}
