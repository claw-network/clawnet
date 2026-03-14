import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { api } from '@/lib/api';
import { getDid } from '@/lib/auth';
import {
  Activity,
  Globe,
  Users,
  Box,
  Clock,
  Fingerprint,
  Copy,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface NodeStatus {
  version?: string;
  network?: string;
  uptime?: number;
  peerId?: string;
  did?: string;
  blockHeight?: number;
  syncStatus?: string;
  peers?: number;
  apiKeysActive?: number;
  [key: string]: unknown;
}

interface PeerInfo {
  peers: Array<{ id: string; addr?: string; protocol?: string }>;
  total: number;
}

export function DashboardPage() {
  const [status, setStatus] = useState<NodeStatus | null>(null);
  const [peerInfo, setPeerInfo] = useState<PeerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [s, p] = await Promise.all([
          api.get<NodeStatus>('/node'),
          api.get<PeerInfo>('/node/peers').catch(() => ({ peers: [], total: 0 })),
        ]);
        setStatus(s);
        setPeerInfo(p);
      } catch {
        // status endpoint is public, so errors likely mean node is down
      } finally {
        setLoading(false);
      }
    }
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, []);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const did = getDid() || status?.did;

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const formatUptime = (ms?: number) => {
    if (!ms) return 'N/A';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your ClawNet node</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <Badge variant="default" className="bg-green-600 text-white">
              Online
            </Badge>
            {status?.version && (
              <p className="mt-1 text-xs text-muted-foreground">v{status.version}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Network</CardTitle>
            <Globe className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize">{status?.network ?? 'unknown'}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Connected Peers</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{peerInfo?.total ?? 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Block Height</CardTitle>
            <Box className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {status?.blockHeight?.toLocaleString() ?? 'N/A'}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Uptime</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatUptime(status?.uptime as number)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">API Keys</CardTitle>
            <Fingerprint className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{status?.apiKeysActive ?? 'N/A'}</div>
            <p className="text-xs text-muted-foreground">active keys</p>
          </CardContent>
        </Card>
      </div>

      <Separator />

      <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
            <CardDescription>Your node's decentralized identity</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow
              label="DID"
              value={did ?? 'N/A'}
              copyable
              copied={copied === 'did'}
              onCopy={() => did && copyToClipboard(did, 'did')}
            />
            <InfoRow
              label="Peer ID"
              value={status?.peerId ?? 'N/A'}
              copyable
              copied={copied === 'peerId'}
              onCopy={() => status?.peerId && copyToClipboard(status.peerId, 'peerId')}
            />
          </CardContent>
        </Card>

        {peerInfo && peerInfo.peers.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Connected Peers</CardTitle>
              <CardDescription>{peerInfo.total} peer(s) connected</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-48 overflow-auto">
                {peerInfo.peers.slice(0, 10).map((peer, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-md border p-2 text-xs"
                  >
                    <span className="font-mono truncate max-w-[200px]">{peer.id}</span>
                    {peer.addr && (
                      <span className="text-muted-foreground truncate max-w-[150px]">
                        {peer.addr}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  copyable,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copyable?: boolean;
  copied?: boolean;
  onCopy?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <div className="flex items-center gap-1 min-w-0">
        <span className="font-mono text-xs truncate">{value}</span>
        {copyable && onCopy && (
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={onCopy}>
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </Button>
        )}
      </div>
    </div>
  );
}
