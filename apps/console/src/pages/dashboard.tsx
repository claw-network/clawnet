import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import { getDid } from '@/lib/auth';
import {
  Activity,
  Globe,
  Users,
  Box,
  Clock,
  Copy,
  Check,
  Radio,
  HardDrive,
  Network,
  Wallet,
  RefreshCw,
  Fingerprint,
  Link2,
  Vote,
  Layers,
  Coins,
  Landmark,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface NodeStatus {
  version?: string;
  network?: string;
  uptime?: number;
  peerId?: string;
  did?: string;
  blockHeight?: number;
  synced?: boolean;
  peers?: number;
  connections?: number;
  config?: {
    dataDir?: string;
    network?: string;
    p2pPort?: number;
    apiPort?: number;
    apiEnabled?: boolean;
  };
  [key: string]: unknown;
}

interface PeerInfo {
  peers: Array<{ peerId: string; pubsub?: boolean; connected?: boolean }>;
  total: number;
}

interface WalletBalance {
  balance?: string | number;
  available?: string | number;
  pending?: string | number;
  locked?: string | number;
}

interface RelayStats {
  relayEnabled?: boolean;
  activeCircuits?: number;
  totalCircuitsServed?: number;
  totalBytesRelayed?: number;
  totalMessagesRelayed?: number;
}

interface ChainSummary {
  treasuryBalance?: number;
  activeProposals?: number;
  totalStaked?: number;
  tokenSupply?: number;
}

interface IdentityInfo {
  did?: string;
  publicKey?: string;
  displayName?: string;
  isActive?: boolean;
  created?: string;
  [key: string]: unknown;
}

export function DashboardPage() {
  const [status, setStatus] = useState<NodeStatus | null>(null);
  const [peerInfo, setPeerInfo] = useState<PeerInfo | null>(null);
  const [wallet, setWallet] = useState<WalletBalance | null>(null);
  const [relay, setRelay] = useState<RelayStats | null>(null);
  const [identity, setIdentity] = useState<IdentityInfo | null>(null);
  const [chain, setChain] = useState<ChainSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const fetchData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const [s, p, r, id] = await Promise.all([
        api.get<NodeStatus>('/node'),
        api.get<PeerInfo>('/node/peers').catch(() => ({ peers: [], total: 0 })),
        api.get<RelayStats>('/relay/stats').catch(() => null),
        api.get<IdentityInfo>('/identities/self').catch(() => null),
      ]);
      setStatus(s);
      setPeerInfo(p);
      setRelay(r);
      setIdentity(id);

      // Fetch wallet balance using the DID, derive EVM address from identity
      if (s?.did) {
        try {
          const did = s.did;
          const w = await api.get<WalletBalance>(`/wallets/${encodeURIComponent(did)}`);
          setWallet(w);
        } catch {
          // wallet might not be available if no chain config
        }
      }

      // Fetch chain summary for testnet/mainnet
      const net = s?.network || s?.config?.network;
      if (net === 'testnet' || net === 'mainnet') {
        try {
          const [treasury, staking, supply] = await Promise.all([
            api.get<{ balance?: number }>('/dao/treasury').catch(() => null),
            api.get<{ totalStaked?: number }>('/staking').catch(() => null),
            api.get<{ totalSupply?: number }>('/token/supply').catch(() => null),
          ]);
          setChain({
            treasuryBalance: treasury?.balance,
            totalStaked: staking?.totalStaked,
            tokenSupply: supply?.totalSupply,
          });
        } catch {
          // chain endpoints might not be available
        }
      }
    } catch {
      // node might be down
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(), 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const did = getDid() || status?.did;

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  const formatUptime = (sec?: number) => {
    if (!sec) return '—';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${sec % 60}s`;
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const truncateMiddle = (str: string, maxLen = 20) => {
    if (str.length <= maxLen) return str;
    const half = Math.floor((maxLen - 3) / 2);
    return `${str.slice(0, half)}…${str.slice(-half)}`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">Node overview and real-time status</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="default" className="bg-green-600 text-white gap-1">
            <Activity className="h-3 w-3" /> Online
          </Badge>
          {status?.version && (
            <Badge variant="outline">v{status.version}</Badge>
          )}
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => fetchData(true)}
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Block Height</CardTitle>
            <Box className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {status?.blockHeight?.toLocaleString() ?? '—'}
            </div>
            <p className="text-xs text-muted-foreground">
              {status?.synced ? 'Synced' : 'Syncing…'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">P2P Network</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{status?.peers ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              {status?.connections ?? 0} connections
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Relay</CardTitle>
            <Radio className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{relay?.activeCircuits ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              {relay?.relayEnabled ? `${relay.totalCircuitsServed ?? 0} total served` : 'Disabled'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Uptime</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatUptime(status?.uptime as number)}</div>
            <p className="text-xs text-muted-foreground capitalize">
              {status?.network ?? 'unknown'} network
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Chain Summary (testnet/mainnet only) */}
      {chain && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Treasury</CardTitle>
              <Landmark className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{chain.treasuryBalance?.toLocaleString() ?? '—'}</div>
              <p className="text-xs text-muted-foreground">Tokens</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Staked</CardTitle>
              <Layers className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{chain.totalStaked?.toLocaleString() ?? '—'}</div>
              <p className="text-xs text-muted-foreground">Tokens</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Token Supply</CardTitle>
              <Coins className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{chain.tokenSupply?.toLocaleString() ?? '—'}</div>
              <p className="text-xs text-muted-foreground">Total supply</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Blockchain</CardTitle>
              <Vote className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <Badge variant="default" className="bg-blue-600 text-white">
                {status?.network ?? 'unknown'}
              </Badge>
              <p className="mt-1 text-xs text-muted-foreground">Chain ID 7625</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Identity + Wallet */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Fingerprint className="h-4 w-4" /> Identity
            </CardTitle>
            <CardDescription>Node's decentralized identity</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <CopyRow
              label="DID"
              value={did ?? '—'}
              copyKey="did"
              copied={copied}
              onCopy={copyToClipboard}
            />
            <CopyRow
              label="Peer ID"
              value={status?.peerId ?? '—'}
              copyKey="peerId"
              copied={copied}
              onCopy={copyToClipboard}
            />
            {identity?.publicKey && (
              <CopyRow
                label="Public Key"
                value={identity.publicKey}
                copyKey="pubkey"
                copied={copied}
                onCopy={copyToClipboard}
              />
            )}
            {identity?.displayName && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground shrink-0">Display Name</span>
                <span className="text-sm font-medium">{identity.displayName}</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground shrink-0">Status</span>
              <Badge variant={identity?.isActive !== false ? 'default' : 'secondary'}>
                {identity?.isActive !== false ? 'Active' : 'Inactive'}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-4 w-4" /> Wallet
            </CardTitle>
            <CardDescription>Token balances for this node's DID</CardDescription>
          </CardHeader>
          <CardContent>
            {wallet ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Total Balance</span>
                  <span className="text-2xl font-bold">{wallet.balance ?? 0} <span className="text-sm font-normal text-muted-foreground">Token</span></span>
                </div>
                <Separator />
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-lg font-semibold">{wallet.available ?? 0}</div>
                    <div className="text-xs text-muted-foreground">Available</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold">{wallet.pending ?? 0}</div>
                    <div className="text-xs text-muted-foreground">Pending</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold">{wallet.locked ?? 0}</div>
                    <div className="text-xs text-muted-foreground">Locked</div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Wallet not available. Chain configuration may not be set.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Node Configuration + Relay Stats */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-4 w-4" /> Node Configuration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <ConfigRow label="Data Directory" value={status?.config?.dataDir ?? '~/.clawnet'} />
              <ConfigRow label="Network" value={status?.config?.network ?? status?.network ?? '—'} />
              <ConfigRow label="API Port" value={String(status?.config?.apiPort ?? 9528)} />
              <ConfigRow label="P2P Port" value={String(status?.config?.p2pPort ?? 9527)} />
              <ConfigRow label="API Enabled" value={status?.config?.apiEnabled !== false ? 'Yes' : 'No'} />
            </div>
          </CardContent>
        </Card>

        {relay && relay.relayEnabled && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Network className="h-4 w-4" /> Relay Statistics
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <ConfigRow label="Status" value="Enabled" />
                <ConfigRow label="Active Circuits" value={String(relay.activeCircuits ?? 0)} />
                <ConfigRow label="Total Served" value={String(relay.totalCircuitsServed ?? 0)} />
                <ConfigRow label="Data Relayed" value={formatBytes(relay.totalBytesRelayed)} />
                <ConfigRow label="Messages Relayed" value={String(relay.totalMessagesRelayed ?? 0)} />
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Peers Table */}
      {peerInfo && peerInfo.peers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="h-4 w-4" /> Connected Peers
            </CardTitle>
            <CardDescription>{peerInfo.total} peer(s)</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Peer ID</TableHead>
                  <TableHead className="w-24 text-center">Pubsub</TableHead>
                  <TableHead className="w-24 text-center">Connected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {peerInfo.peers.slice(0, 20).map((peer, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <code className="text-xs" title={peer.peerId}>
                        {truncateMiddle(peer.peerId, 40)}
                      </code>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={peer.pubsub ? 'default' : 'secondary'} className="text-xs">
                        {peer.pubsub ? 'Yes' : 'No'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={peer.connected ? 'default' : 'secondary'} className="text-xs">
                        {peer.connected ? 'Yes' : 'No'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {peerInfo.total > 20 && (
              <p className="mt-2 text-xs text-muted-foreground text-center">
                Showing 20 of {peerInfo.total} peers
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ── Helper Components ─────────────────────────────────────────────── */

function CopyRow({
  label,
  value,
  copyKey,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copyKey: string;
  copied: string | null;
  onCopy: (text: string, key: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <div className="flex items-center gap-1 min-w-0">
        <code className="text-xs truncate max-w-[240px]" title={value}>{value}</code>
        {value !== '—' && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => onCopy(value, copyKey)}
          >
            {copied === copyKey ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </Button>
        )}
      </div>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}
