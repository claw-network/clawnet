import { useState, type FormEvent } from 'react';
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
import { verifyPassphrase, setAuthenticated } from '@/lib/auth';
import { KeyRound, Loader2 } from 'lucide-react';

export function LoginPage() {
  const navigate = useNavigate();
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!passphrase.trim()) return;

    setLoading(true);
    setError('');

    try {
      const result = await verifyPassphrase(passphrase);
      if (result.valid && result.did) {
        setAuthenticated(result.did);
        navigate('/console', { replace: true });
      } else {
        setError('Invalid passphrase. Please try again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <form onSubmit={handleSubmit}>
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
