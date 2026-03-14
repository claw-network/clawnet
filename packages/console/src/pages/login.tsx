import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <KeyRound className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl">ClawNet Console</CardTitle>
          <CardDescription>Enter your node passphrase to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="grid gap-2">
              <Label htmlFor="passphrase">Passphrase</Label>
              <Input
                id="passphrase"
                type="password"
                placeholder="Enter CLAW_PASSPHRASE"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoFocus
                disabled={loading}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading || !passphrase.trim()}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verifying…
                </>
              ) : (
                'Unlock Console'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
