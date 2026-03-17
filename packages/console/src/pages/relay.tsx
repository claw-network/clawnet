import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import {
  Radio,
  ArrowUpDown,
  Shield,
  Globe,
  Wifi,
  WifiOff,
  RefreshCw,
  Activity,
  HardDrive,
  MessageSquare,
  Users,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Power,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────── */

interface RelayStats {
  relayEnabled?: boolean;
  totalCircuitsServed?: number;
  activeCircuits?: number;
  totalBytesRelayed?: number;
  totalMessagesRelayed?: number;
  totalAttachmentBytesRelayed?: number;
  uptimeSeconds?: number;
  periodStats?: {
    periodStart?: number;
    periodEnd?: number;
    bytesRelayed?: number;
    attachmentBytesRelayed?: number;
    circuitsServed?: number;
    uniquePeersServed?: number;
  };
}

interface RelayHealth {
  relayEnabled?: boolean;
  natStatus?: 'public' | 'private' | 'unknown';
  publicAddresses?: string[];
  isReachable?: boolean;
  load?: {
    activeCircuits?: number;
    maxCircuits?: number;
    utilizationPercent?: number;
  };
  warnings?: string[];
}

interface RelayAccess {
  mode?: 'open' | 'whitelist' | 'blacklist';
  list?: string[];
}

interface RelayPeers {
  peers?: string[];
  count?: number;
  draining?: boolean;
}

interface PeriodProof {
  relayDid?: string;
  periodId?: number;
  periodStart?: number;
  periodEnd?: number;
  bytesRelayed?: number;
  circuitsServed?: number;
  uniquePeersServed?: number;
  peerConfirmations?: Array<{
    peerDid?: string;
    bytesConfirmed?: number;
    circuitsConfirmed?: number;
  }>;
}

/* ── Page Component ────────────────────────────────────────────── */

export function RelayPage() {
  const [stats, setStats] = useState<RelayStats | null>(null);
  const [health, setHealth] = useState<RelayHealth | null>(null);
  const [access, setAccess] = useState<RelayAccess | null>(null);
  const [peers, setPeers] = useState<RelayPeers | null>(null);
  const [proof, setProof] = useState<PeriodProof | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [showProof, setShowProof] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  const fetchData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const [s, h, a, p, pr] = await Promise.all([
        api.get<RelayStats>('/relay/stats').catch(() => null),
        api.get<RelayHealth>('/relay/health').catch(() => null),
        api.get<RelayAccess>('/relay/access').catch(() => null),
        api.get<RelayPeers>('/relay/peers').catch(() => null),
        api.get<PeriodProof>('/relay/period-proof').catch(() => null),
      ]);
      setStats(s);
      setHealth(h);
      setAccess(a);
      setPeers(p);
      setProof(pr);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load relay data');
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

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleToggle = async (enabled: boolean) => {
    setToggling(true);
    try {
      await api.post<{ enabled: boolean }>('/relay/toggle', { enabled });
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle relay');
    } finally {
      setToggling(false);
    }
  };

  const isEnabled = health?.relayEnabled ?? stats?.relayEnabled ?? false;

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
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (!isEnabled) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">P2P Relay</h1>
            <p className="text-muted-foreground">Relay service management and monitoring</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Relay</span>
            <Switch
              checked={false}
              onCheckedChange={(checked) => handleToggle(checked)}
              disabled={toggling}
            />
          </div>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <WifiOff className="h-16 w-16 text-muted-foreground/30 mb-4" />
            <h2 className="text-xl font-semibold mb-2">Relay is disabled</h2>
            <p className="text-muted-foreground max-w-md mb-4">
              The P2P relay service allows your node to help other peers connect through NAT.
              Relay operators earn Token rewards for their contribution.
            </p>
            <Button
              onClick={() => handleToggle(true)}
              disabled={toggling}
              className="gap-2"
            >
              <Power className="h-4 w-4" />
              {toggling ? 'Enabling...' : 'Enable Relay'}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const utilization = health?.load?.utilizationPercent ?? 0;
  const maxCircuits = health?.load?.maxCircuits ?? 0;
  const activeCircuits = stats?.activeCircuits ?? health?.load?.activeCircuits ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">P2P Relay</h1>
          <p className="text-muted-foreground">Relay service management and monitoring</p>
        </div>
        <div className="flex items-center gap-2">
          {peers?.draining && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> Draining
            </Badge>
          )}
          <Badge variant="default" className="bg-green-600 text-white gap-1">
            <Activity className="h-3 w-3" /> Active
          </Badge>
          <Separator orientation="vertical" className="h-6" />
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Relay</span>
            <Switch
              checked={true}
              onCheckedChange={(checked) => handleToggle(checked)}
              disabled={toggling}
            />
          </div>
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

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Warnings */}
      {health?.warnings && health.warnings.length > 0 && (
        <div className="space-y-2">
          {health.warnings.map((w, i) => (
            <Alert key={i} variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{w}</AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {/* ── Metric Cards ───────────────────────────────────────── */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <MetricCard
          icon={ArrowUpDown}
          label="Active Circuits"
          value={activeCircuits}
          sub={`of ${maxCircuits} max`}
        />
        <MetricCard
          icon={HardDrive}
          label="Data Relayed"
          value={formatBytes(stats?.totalBytesRelayed)}
          sub={`${formatBytes(stats?.totalAttachmentBytesRelayed)} attachments`}
        />
        <MetricCard
          icon={MessageSquare}
          label="Messages"
          value={stats?.totalMessagesRelayed ?? 0}
          sub={`${stats?.totalCircuitsServed ?? 0} total circuits`}
        />
        <MetricCard
          icon={Clock}
          label="Relay Uptime"
          value={formatDuration(stats?.uptimeSeconds)}
          sub="since last restart"
        />
      </div>

      {/* ── Circuit Utilization ─────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Circuit Utilization</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {/* Main bar */}
            <div className="relative">
              <div className="flex items-center justify-between text-sm mb-1.5">
                <span className="font-medium">{activeCircuits} active</span>
                <span className="text-muted-foreground">{maxCircuits} max</span>
              </div>
              <div className="h-4 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barColor(utilization)}`}
                  style={{ width: `${Math.max(Math.min(utilization, 100), 0)}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-muted-foreground">0%</span>
                <span className={`text-sm font-bold ${textColor(utilization)}`}>
                  {utilization.toFixed(1)}%
                </span>
                <span className="text-xs text-muted-foreground">100%</span>
              </div>
            </div>

            <Separator />

            {/* Scale markers */}
            <div className="flex gap-3 text-xs">
              <div className="flex items-center gap-1.5">
                <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
                <span className="text-muted-foreground">0-50% Healthy</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                <span className="text-muted-foreground">50-80% Moderate</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
                <span className="text-muted-foreground">80%+ High Load</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Health & Access ─────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Network Health */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="h-4 w-4" /> Network Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <StatusIndicator
                label="NAT Status"
                value={health?.natStatus ?? 'unknown'}
                good={health?.natStatus === 'public'}
              />
              <StatusIndicator
                label="Reachable"
                value={health?.isReachable ? 'Yes' : 'No'}
                good={health?.isReachable ?? false}
              />
            </div>

            {/* Public Addresses */}
            {health?.publicAddresses && health.publicAddresses.length > 0 && (
              <>
                <Separator />
                <div>
                  <span className="text-xs font-medium text-muted-foreground mb-2 block">
                    Public Addresses ({health.publicAddresses.length})
                  </span>
                  <div className="space-y-1">
                    {health.publicAddresses.map((addr, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded border bg-muted/30 px-2 py-1"
                      >
                        <code className="text-xs font-mono truncate" title={addr}>
                          {addr}
                        </code>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 shrink-0"
                          onClick={() => copyText(addr, `addr-${i}`)}
                        >
                          {copied === `addr-${i}` ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Access Control */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4" /> Access Control
            </CardTitle>
            <CardDescription>
              Who can use this relay
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Badge
                className={
                  access?.mode === 'open'
                    ? 'bg-green-600 text-white'
                    : access?.mode === 'whitelist'
                      ? 'bg-blue-600 text-white'
                      : access?.mode === 'blacklist'
                        ? 'bg-red-600 text-white'
                        : ''
                }
              >
                {access?.mode ?? 'open'}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {access?.mode === 'open' && 'Any peer can use this relay'}
                {access?.mode === 'whitelist' && 'Only listed peers allowed'}
                {access?.mode === 'blacklist' && 'Listed peers are blocked'}
              </span>
            </div>

            {access?.list && access.list.length > 0 && (
              <>
                <Separator />
                <div>
                  <span className="text-xs font-medium text-muted-foreground mb-2 block">
                    {access.mode === 'whitelist' ? 'Allowed' : 'Blocked'} DIDs ({access.list.length})
                  </span>
                  <div className="space-y-1 max-h-32 overflow-auto">
                    {access.list.map((did, i) => (
                      <div
                        key={i}
                        className="rounded border bg-muted/30 px-2 py-1 font-mono text-xs truncate"
                        title={did}
                      >
                        {did}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {(!access?.list || access.list.length === 0) && access?.mode !== 'open' && (
              <p className="text-sm text-muted-foreground">No DIDs in the list.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Current Period ──────────────────────────────────────── */}
      {stats?.periodStats && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Current Period</CardTitle>
            <CardDescription>
              {formatTimestamp(stats.periodStats.periodStart)} → {formatTimestamp(stats.periodStats.periodEnd)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <PeriodStat label="Bytes Relayed" value={formatBytes(stats.periodStats.bytesRelayed)} />
              <PeriodStat
                label="Attachment Bytes"
                value={formatBytes(stats.periodStats.attachmentBytesRelayed)}
              />
              <PeriodStat label="Circuits Served" value={stats.periodStats.circuitsServed ?? 0} />
              <PeriodStat
                label="Unique Peers"
                value={stats.periodStats.uniquePeersServed ?? 0}
                icon={Users}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Active Relay Peers ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wifi className="h-4 w-4" /> Active Relay Peers
          </CardTitle>
          <CardDescription>
            {peers?.count ?? 0} peer(s) currently using this relay
          </CardDescription>
        </CardHeader>
        <CardContent>
          {peers?.peers && peers.peers.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Peer ID</TableHead>
                  <TableHead className="w-16 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {peers.peers.map((peerId, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell>
                      <code className="text-xs" title={peerId}>
                        {truncate(peerId, 50)}
                      </code>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => copyText(peerId, `peer-${i}`)}
                      >
                        {copied === `peer-${i}` ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center py-8 text-center text-muted-foreground">
              <Radio className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">No peers are currently using this relay.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Period Proof (Collapsible) ─────────────────────────── */}
      {proof && (proof as Record<string, unknown>).periodId !== undefined && (
        <Card>
          <CardHeader
            className="cursor-pointer select-none"
            onClick={() => setShowProof(!showProof)}
          >
            <CardTitle className="flex items-center gap-2 text-base">
              {showProof ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <Shield className="h-4 w-4" /> Last Period Proof
            </CardTitle>
            <CardDescription>
              Period #{proof.periodId} — {proof.peerConfirmations?.length ?? 0} confirmations
            </CardDescription>
          </CardHeader>
          {showProof && (
            <CardContent>
              <div className="relative">
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-2 h-7 w-7"
                  onClick={() => copyText(JSON.stringify(proof, null, 2), 'proof')}
                >
                  {copied === 'proof' ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
                <div className="rounded-md border bg-muted/50 p-4 overflow-auto max-h-64">
                  <pre className="text-xs font-mono whitespace-pre-wrap">
                    {JSON.stringify(proof, null, 2)}
                  </pre>
                </div>
              </div>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────────────── */

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function StatusIndicator({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  good: boolean;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <div
          className={`h-2.5 w-2.5 rounded-full ${good ? 'bg-green-500' : 'bg-amber-500'}`}
        />
        <span className="text-sm font-medium capitalize">{value}</span>
      </div>
    </div>
  );
}

function PeriodStat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3 text-center">
      {Icon && <Icon className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />}
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

/* ── Helpers ───────────────────────────────────────────────────── */

function barColor(pct: number): string {
  if (pct > 80) return 'bg-red-500';
  if (pct > 50) return 'bg-amber-500';
  return 'bg-green-500';
}

function textColor(pct: number): string {
  if (pct > 80) return 'text-red-600 dark:text-red-400';
  if (pct > 50) return 'text-amber-600 dark:text-amber-400';
  return 'text-green-600 dark:text-green-400';
}

function formatBytes(bytes?: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDuration(sec?: number): string {
  if (!sec) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${sec % 60}s`;
}

function formatTimestamp(ts?: number): string {
  if (!ts) return '—';
  // ts can be seconds or milliseconds
  const ms = ts < 1e12 ? ts * 1000 : ts;
  return new Date(ms).toLocaleString();
}

function truncate(str: string, max = 40): string {
  if (str.length <= max) return str;
  const half = Math.floor((max - 1) / 2);
  return `${str.slice(0, half)}…${str.slice(-half)}`;
}
