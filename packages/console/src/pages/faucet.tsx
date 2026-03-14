import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { api } from '@/lib/api';
import { Droplets, Clock, Coins } from 'lucide-react';

interface FaucetStatus {
  enabled?: boolean;
  amount?: number;
  cooldown?: number;
  totalClaims?: number;
  [key: string]: unknown;
}

export function FaucetPage() {
  const [status, setStatus] = useState<FaucetStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchData() {
      try {
        const data = await api.get<FaucetStatus>('/faucet/status').catch(() => null);
        setStatus(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load faucet info');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Faucet</h1>
        <p className="text-muted-foreground">Token faucet configuration and status</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Faucet Status</CardTitle>
            <Droplets className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <Badge variant={status?.enabled !== false ? 'default' : 'secondary'}>
              {status?.enabled !== false ? 'Enabled' : 'Disabled'}
            </Badge>
            <p className="mt-1 text-xs text-muted-foreground">
              {status?.enabled === false
                ? 'Set CLAW_FAUCET_ENABLED=true to enable'
                : 'Faucet is active for new DIDs'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Claim Amount</CardTitle>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{status?.amount ?? 100}</div>
            <p className="text-xs text-muted-foreground">Tokens per claim</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Cooldown</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{status?.cooldown ?? 'N/A'}</div>
            <p className="text-xs text-muted-foreground">seconds between claims</p>
          </CardContent>
        </Card>
      </div>

      {status && (
        <Card>
          <CardHeader>
            <CardTitle>Faucet Details</CardTitle>
            <CardDescription>Complete faucet runtime data</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border bg-muted/50 p-4 overflow-auto max-h-64">
              <pre className="text-xs font-mono whitespace-pre-wrap">
                {JSON.stringify(status, null, 2)}
              </pre>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
