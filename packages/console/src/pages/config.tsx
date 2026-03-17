import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import {
  Settings,
  Globe,
  Radio,
  Shield,
  HardDrive,
  Wifi,
  WifiOff,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Database,
  FileKey,
  FileText,
  Copy,
  Check,
  Droplets,
  Link2,
  Lock,
  Eye,
  EyeOff,
  Server,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────── */

interface NodeInfo {
  did?: string;
  peerId?: string;
  synced?: boolean;
  blockHeight?: number;
  peers?: number;
  connections?: number;
  network?: string;
  version?: string;
  uptime?: number;
  config?: {
    dataDir?: string;
    network?: string;
    p2pPort?: number;
    apiPort?: number;
    apiEnabled?: boolean;
  };
}

interface RelayHealth {
  relayEnabled?: boolean;
  natStatus?: string;
  publicAddresses?: string[];
  isReachable?: boolean;
  load?: {
    activeCircuits?: number;
    maxCircuits?: number;
    utilizationPercent?: number;
  };
  warnings?: string[];
}

interface RelayStats {
  relayEnabled?: boolean;
  activeCircuits?: number;
  totalCircuitsServed?: number;
  totalBytesRelayed?: number;
  totalMessagesRelayed?: number;
}

/* ── Page Component ────────────────────────────────────────────── */

export function ConfigPage() {
  const [info, setInfo] = useState<NodeInfo | null>(null);
  const [relayHealth, setRelayHealth] = useState<RelayHealth | null>(null);
  const [relayStats, setRelayStats] = useState<RelayStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const fetchData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const [nodeData, health, stats] = await Promise.all([
        api.get<NodeInfo>('/node'),
        api.get<RelayHealth>('/relay/health').catch(() => null),
        api.get<RelayStats>('/relay/stats').catch(() => null),
      ]);
      setInfo(nodeData);
      setRelayHealth(health);
      setRelayStats(stats);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load config');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      </div>
    );
  }

  const cfg = info?.config as Record<string, unknown> | undefined;
  const network = (cfg?.network ?? info?.network ?? 'unknown') as string;
  const chainEnabled = Boolean(cfg?.chainEnabled);
  const isChainConnected = chainEnabled && (info?.blockHeight ?? 0) > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Configuration</h1>
          <p className="text-muted-foreground">Active runtime configuration (read-only)</p>
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

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ── Service Status Grid ─────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Services</h2>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          <ServiceCard
            icon={Server}
            label="HTTP API"
            active={cfg?.apiEnabled !== false}
            detail={`Port ${cfg?.apiPort ?? 9528}`}
          />
          <ServiceCard
            icon={Globe}
            label="P2P Network"
            active={info?.synced ?? false}
            detail={`Port ${cfg?.p2pPort ?? 9527}`}
          />
          <ServiceCard
            icon={Radio}
            label="Relay"
            active={relayHealth?.relayEnabled ?? relayStats?.relayEnabled ?? false}
            detail={
              relayHealth?.relayEnabled
                ? `${relayStats?.activeCircuits ?? 0} circuits`
                : 'Disabled'
            }
          />
          {network !== 'devnet' && (
            <ServiceCard
              icon={Link2}
              label="Blockchain"
              active={isChainConnected}
              detail={
                isChainConnected
                  ? `Block #${info?.blockHeight?.toLocaleString()}`
                  : 'Syncing...'
              }
            />
          )}
          {network !== 'devnet' && (
            <ServiceCard
              icon={Droplets}
              label="Faucet"
              active={network === 'testnet'}
              detail={network === 'testnet' ? 'Testnet only' : 'N/A'}
            />
          )}
        </div>
      </div>

      {/* ── Network & Identity ──────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="h-4 w-4" /> Network
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Network</span>
              <Badge
                className={
                  network === 'mainnet'
                    ? 'bg-red-600 text-white'
                    : network === 'testnet'
                      ? 'bg-amber-600 text-white'
                      : 'bg-blue-600 text-white'
                }
              >
                {network}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Version</span>
              <span className="font-mono text-sm">v{info?.version ?? '—'}</span>
            </div>
            <Separator />

            {/* Port Visualization */}
            <div className="space-y-2">
              <span className="text-sm font-medium">Listening Ports</span>
              <div className="grid grid-cols-2 gap-2">
                <PortBadge port={cfg?.apiPort ?? 9528} label="HTTP API" active={cfg?.apiEnabled !== false} />
                <PortBadge port={cfg?.p2pPort ?? 9527} label="P2P TCP" active={info?.synced ?? false} />
              </div>
            </div>

            <Separator />

            {/* Peer Stats */}
            <div className="space-y-2">
              <span className="text-sm font-medium">Connectivity</span>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  {(info?.peers ?? 0) > 0 ? (
                    <Wifi className="h-4 w-4 text-green-500" />
                  ) : (
                    <WifiOff className="h-4 w-4 text-muted-foreground" />
                  )}
                  <div>
                    <div className="text-lg font-bold">{info?.peers ?? 0}</div>
                    <div className="text-xs text-muted-foreground">Pubsub Peers</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="text-lg font-bold">{info?.connections ?? 0}</div>
                    <div className="text-xs text-muted-foreground">Connections</div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Relay Health */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Radio className="h-4 w-4" /> Relay
            </CardTitle>
            <CardDescription>
              {relayHealth?.relayEnabled ? 'Relay service is active' : 'Relay is not enabled'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {relayHealth?.relayEnabled ? (
              <div className="space-y-4">
                {/* NAT & Reachability */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">NAT Status</div>
                    <Badge
                      variant={relayHealth.natStatus === 'public' ? 'default' : 'secondary'}
                    >
                      {relayHealth.natStatus ?? 'unknown'}
                    </Badge>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Reachable</div>
                    <Badge variant={relayHealth.isReachable ? 'default' : 'destructive'}>
                      {relayHealth.isReachable ? 'Yes' : 'No'}
                    </Badge>
                  </div>
                </div>

                {/* Circuit Utilization Bar */}
                {relayHealth.load && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Circuit Utilization</span>
                      <span className="font-mono">
                        {relayHealth.load.activeCircuits ?? 0} / {relayHealth.load.maxCircuits ?? 0}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          (relayHealth.load.utilizationPercent ?? 0) > 80
                            ? 'bg-red-500'
                            : (relayHealth.load.utilizationPercent ?? 0) > 50
                              ? 'bg-amber-500'
                              : 'bg-green-500'
                        }`}
                        style={{ width: `${Math.min(relayHealth.load.utilizationPercent ?? 0, 100)}%` }}
                      />
                    </div>
                  </div>
                )}

                <Separator />

                {/* Traffic Stats */}
                {relayStats && (
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-lg font-bold">{relayStats.totalCircuitsServed ?? 0}</div>
                      <div className="text-xs text-muted-foreground">Circuits Served</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold">{formatBytes(relayStats.totalBytesRelayed)}</div>
                      <div className="text-xs text-muted-foreground">Data Relayed</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold">{relayStats.totalMessagesRelayed ?? 0}</div>
                      <div className="text-xs text-muted-foreground">Messages</div>
                    </div>
                  </div>
                )}

                {/* Public Addresses */}
                {relayHealth.publicAddresses && relayHealth.publicAddresses.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">Public Addresses</span>
                      {relayHealth.publicAddresses.map((addr, i) => (
                        <div
                          key={i}
                          className="rounded border bg-muted/50 px-2 py-1 font-mono text-xs break-all"
                        >
                          {addr}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Warnings */}
                {relayHealth.warnings && relayHealth.warnings.length > 0 && (
                  <>
                    <Separator />
                    {relayHealth.warnings.map((w, i) => (
                      <Alert key={i} variant="destructive">
                        <AlertDescription className="text-xs">{w}</AlertDescription>
                      </Alert>
                    ))}
                  </>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground">
                <WifiOff className="h-8 w-8 mb-2" />
                <p className="text-sm">Relay is not enabled on this node.</p>
                <p className="text-xs mt-1">
                  Set <code className="font-mono text-foreground">CLAW_RELAY_ENABLED=true</code> to enable.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Storage Layout ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HardDrive className="h-4 w-4" /> Storage Layout
          </CardTitle>
          <CardDescription>
            Data directory: <code className="font-mono text-foreground">{cfg?.dataDir ?? '~/.clawnet'}</code>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border bg-muted/30 p-4 font-mono text-sm space-y-1">
            <TreeLine icon={FolderOpen} label={cfg?.dataDir ?? '~/.clawnet'} root />
            <TreeLine icon={FolderOpen} label="keys/" indent={1} desc="Identity key records (encrypted)" />
            <TreeLine icon={FileKey} label="*.key.json" indent={2} desc="Ed25519 key (Argon2id)" />
            <TreeLine icon={FolderOpen} label="data/" indent={1} desc="LevelDB stores" />
            <TreeLine icon={Database} label="events/" indent={2} desc="Event log" />
            <TreeLine icon={Database} label="state/" indent={2} desc="Materialized state" />
            <TreeLine icon={FolderOpen} label="logs/" indent={1} desc="Daemon log files" />
            <TreeLine icon={FileText} label="config.yaml" indent={1} desc="Persisted configuration" />
            <TreeLine icon={Database} label="api-keys.sqlite" indent={1} desc="API key database" />
            <TreeLine icon={Database} label="indexer.sqlite" indent={1} desc="Chain event indexer" />
          </div>
        </CardContent>
      </Card>

      {/* ── Environment Variables ───────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-4 w-4" /> Environment Variables
          </CardTitle>
          <CardDescription>Key CLAW_* variables (sensitive values masked)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {ENV_VARS.map((env) => (
              <EnvRow key={env.name} env={env} copied={copied} onCopy={copyText} />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Raw JSON ────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setShowRaw(!showRaw)}
        >
          <CardTitle className="flex items-center gap-2 text-base">
            {showRaw ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <Settings className="h-4 w-4" /> Raw Configuration
          </CardTitle>
          <CardDescription>Complete runtime data from /api/v1/node</CardDescription>
        </CardHeader>
        {showRaw && (
          <CardContent>
            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-2 h-7 w-7"
                onClick={() => copyText(JSON.stringify(info, null, 2), 'raw')}
              >
                {copied === 'raw' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </Button>
              <div className="rounded-md border bg-muted/50 p-4 overflow-auto max-h-96">
                <pre className="text-xs font-mono whitespace-pre-wrap">
                  {JSON.stringify(info, null, 2)}
                </pre>
              </div>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

/* ── Service Status Card ───────────────────────────────────────── */

function ServiceCard({
  icon: Icon,
  label,
  active,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  detail: string;
}) {
  return (
    <div
      className={`relative rounded-lg border p-3 transition-colors ${
        active ? 'border-green-500/40 bg-green-500/5' : 'border-border bg-muted/30'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <div
          className={`h-2 w-2 rounded-full ${active ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/30'}`}
        />
        <Icon className={`h-4 w-4 ${active ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`} />
      </div>
      <div className="text-sm font-medium">{label}</div>
      <div className="text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

/* ── Port Badge ────────────────────────────────────────────────── */

function PortBadge({ port, label, active }: { port: number; label: string; active: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2">
      <div className={`h-2 w-2 rounded-full ${active ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
      <div>
        <div className="font-mono text-sm font-bold">{port}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

/* ── Tree Line (File Tree) ─────────────────────────────────────── */

function TreeLine({
  icon: Icon,
  label,
  indent = 0,
  desc,
  root,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  indent?: number;
  desc?: string;
  root?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5" style={{ paddingLeft: `${indent * 20}px` }}>
      {!root && <span className="text-muted-foreground/50">├─</span>}
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className={root ? 'font-bold text-foreground' : ''}>{label}</span>
      {desc && <span className="text-muted-foreground text-xs ml-1">— {desc}</span>}
    </div>
  );
}

/* ── Environment Variable Row ──────────────────────────────────── */

interface EnvVar {
  name: string;
  sensitive?: boolean;
  desc: string;
}

const ENV_VARS: EnvVar[] = [
  { name: 'CLAW_PASSPHRASE', sensitive: true, desc: 'Identity key unlock passphrase' },
  { name: 'CLAW_API_KEY', sensitive: true, desc: 'API authentication key' },
  { name: 'CLAW_PRIVATE_KEY', sensitive: true, desc: 'EVM signer private key' },
  { name: 'CLAW_CHAIN_RPC', desc: 'Chain JSON-RPC endpoint URL' },
  { name: 'CLAW_DATA_DIR', desc: 'Override data directory path' },
  { name: 'CLAW_NETWORK', desc: 'Network: mainnet | testnet | devnet' },
  { name: 'CLAW_API_HOST', desc: 'API listen host (default: 127.0.0.1)' },
  { name: 'CLAW_API_PORT', desc: 'API listen port (default: 9528)' },
  { name: 'CLAW_RELAY_ENABLED', desc: 'Enable P2P relay service' },
  { name: 'CLAW_FAUCET_ENABLED', desc: 'Enable token faucet (testnet only)' },
];

function EnvRow({
  env,
  copied,
  onCopy,
}: {
  env: EnvVar;
  copied: string | null;
  onCopy: (text: string, key: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-muted/50 transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        {env.sensitive ? (
          <Lock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        ) : (
          <Settings className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <div className="min-w-0">
          <code className="text-xs font-mono">{env.name}</code>
          <p className="text-xs text-muted-foreground truncate">{env.desc}</p>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {env.sensitive ? (
          <>
            <span className="text-xs font-mono text-muted-foreground">
              {revealed ? '(check process env)' : '••••••••'}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setRevealed(!revealed)}
            >
              {revealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </Button>
          </>
        ) : (
          <>
            <Badge variant="outline" className="text-xs font-mono">
              runtime
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onCopy(env.name, env.name)}
            >
              {copied === env.name ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Helpers ───────────────────────────────────────────────────── */

function formatBytes(bytes?: number) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
