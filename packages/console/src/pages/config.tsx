import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { api } from '@/lib/api';
import { Settings } from 'lucide-react';

interface NodeConfig {
  [key: string]: unknown;
}

export function ConfigPage() {
  const [config, setConfig] = useState<NodeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchConfig() {
      try {
        const data = await api.get<NodeConfig>('/node');
        setConfig(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load config');
      } finally {
        setLoading(false);
      }
    }
    fetchConfig();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configuration</h1>
        <p className="text-muted-foreground">Active node configuration (read-only)</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {config && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Node Info
              </CardTitle>
              <CardDescription>Current runtime configuration from /api/v1/node</CardDescription>
            </CardHeader>
            <CardContent>
              <ConfigSection data={config} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Environment Variables</CardTitle>
              <CardDescription>Key CLAW_* environment variables detected</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {[
                  'CLAW_PASSPHRASE',
                  'CLAW_PRIVATE_KEY',
                  'CLAW_API_KEY',
                  'CLAW_CHAIN_RPC',
                  'CLAW_DATA_DIR',
                  'CLAW_NETWORK',
                  'CLAW_FAUCET_ENABLED',
                  'CLAW_RELAY_ENABLED',
                  'CLAW_RELAY_FEE',
                ].map((name) => (
                  <div key={name} className="flex items-center justify-between text-sm">
                    <code className="text-xs">{name}</code>
                    <Badge variant="secondary" className="text-xs">
                      {name.includes('PASSPHRASE') || name.includes('PRIVATE_KEY')
                        ? '••••••'
                        : 'runtime'}
                    </Badge>
                  </div>
                ))}
              </div>
              <Separator className="my-3" />
              <p className="text-xs text-muted-foreground">
                Sensitive values are hidden. Check the node process environment for actual values.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ports</CardTitle>
              <CardDescription>Network listening ports</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>HTTP API</span>
                <Badge>9528</Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>P2P libp2p</span>
                <Badge>9527</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function ConfigSection({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="rounded-md border bg-muted/50 p-4 overflow-auto max-h-96">
      <pre className="text-xs font-mono whitespace-pre-wrap">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
