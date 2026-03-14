import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { api } from '@/lib/api';
import { Radio, ArrowUpDown, Coins } from 'lucide-react';

interface RelayConfig {
  enabled?: boolean;
  hopEnabled?: boolean;
  fee?: number;
  maxCircuits?: number;
  maxReservations?: number;
  [key: string]: unknown;
}

interface RelayStats {
  totalRelayed?: number;
  activeCircuits?: number;
  totalRewards?: number;
  [key: string]: unknown;
}

export function RelayPage() {
  const [config, setConfig] = useState<RelayConfig | null>(null);
  const [stats, setStats] = useState<RelayStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchData() {
      try {
        const [c, s] = await Promise.all([
          api.get<RelayConfig>('/relay/config').catch(() => null),
          api.get<RelayStats>('/relay/stats').catch(() => null),
        ]);
        setConfig(c);
        setStats(s);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load relay info');
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
        <h1 className="text-2xl font-bold tracking-tight">P2P Relay</h1>
        <p className="text-muted-foreground">Relay configuration and statistics</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Relay Status</CardTitle>
            <Radio className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <Badge variant={config?.enabled ? 'default' : 'secondary'}>
              {config?.enabled ? 'Enabled' : 'Disabled'}
            </Badge>
            {config?.hopEnabled !== undefined && (
              <p className="mt-1 text-xs text-muted-foreground">
                Hop: {config.hopEnabled ? 'Yes' : 'No'}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Active Circuits</CardTitle>
            <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.activeCircuits ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              Max: {config?.maxCircuits ?? 'unlimited'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Relay Fee</CardTitle>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{config?.fee ?? 0}</div>
            <p className="text-xs text-muted-foreground">Tokens per relay</p>
          </CardContent>
        </Card>
      </div>

      {(config || stats) && (
        <Card>
          <CardHeader>
            <CardTitle>Raw Relay Data</CardTitle>
            <CardDescription>Full relay configuration and statistics</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              {config && (
                <div>
                  <h3 className="text-sm font-medium mb-2">Configuration</h3>
                  <div className="rounded-md border bg-muted/50 p-3 overflow-auto max-h-64">
                    <pre className="text-xs font-mono whitespace-pre-wrap">
                      {JSON.stringify(config, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
              {stats && (
                <div>
                  <h3 className="text-sm font-medium mb-2">Statistics</h3>
                  <div className="rounded-md border bg-muted/50 p-3 overflow-auto max-h-64">
                    <pre className="text-xs font-mono whitespace-pre-wrap">
                      {JSON.stringify(stats, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
