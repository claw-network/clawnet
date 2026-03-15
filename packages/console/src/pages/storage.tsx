import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
import {
  Database,
  HardDrive,
  FolderOpen,
  Camera,
  RefreshCw,
  Check,
  Copy,
  Clock,
  Hash,
  FileKey,
  Layers,
  AlertCircle,
  Loader2,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────── */

interface StorageInfo {
  dataDir: string;
  network: string;
  databases: Array<{ name: string; path?: string; size?: number }>;
  directories: Array<{ name: string; path?: string; files?: number }>;
}

interface SnapshotInfo {
  hash?: string;
  createdAt?: string;
  version?: number;
  eventId?: string;
  prev?: string | null;
  signatures?: number;
  stateKeys?: string[];
}

interface SnapshotResult {
  created: boolean;
  reason?: string;
  hash?: string;
  createdAt?: string;
  version?: number;
  eventId?: string;
  prev?: string | null;
  signatures?: number;
  stateKeys?: string[];
}

/* ── Page Component ────────────────────────────────────────────── */

export function StoragePage() {
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [snapshotting, setSnapshotting] = useState(false);
  const [snapshotResult, setSnapshotResult] = useState<SnapshotResult | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [nodeInfo, latestSnap] = await Promise.all([
        api.get<Record<string, unknown>>('/node'),
        api.get<SnapshotInfo | null>('/snapshots/latest').catch(() => null),
      ]);

      setStorage({
        dataDir: (nodeInfo.dataDir as string) || '~/.clawnet',
        network: (nodeInfo.network as string) || 'unknown',
        databases: [
          { name: 'events.sqlite', path: 'data/events.db' },
          { name: 'indexer.sqlite', path: 'indexer.sqlite' },
          { name: 'api-keys.sqlite', path: 'api-keys.sqlite' },
          { name: 'messages.sqlite', path: 'messages.sqlite' },
        ],
        directories: [
          { name: 'keys/', path: 'keys/' },
          { name: 'data/', path: 'data/' },
          { name: 'data/snapshots/', path: 'data/snapshots/' },
          { name: 'logs/', path: 'logs/' },
        ],
      });
      setSnapshot(latestSnap);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load storage info');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleTakeSnapshot = async () => {
    setSnapshotting(true);
    setSnapshotResult(null);
    try {
      const result = await api.post<SnapshotResult>('/snapshots', {});
      setSnapshotResult(result);
      if (result.created) {
        // Refresh snapshot info
        const latest = await api.get<SnapshotInfo | null>('/snapshots/latest').catch(() => null);
        setSnapshot(latest);
      }
    } catch (err) {
      setSnapshotResult({
        created: false,
        reason: err instanceof Error ? err.message : 'Snapshot failed',
      });
    } finally {
      setSnapshotting(false);
    }
  };

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Storage</h1>
          <p className="text-muted-foreground">Node data directory, databases, and snapshots</p>
        </div>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={fetchData}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Data Directory */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <HardDrive className="h-4 w-4" /> Data Directory
            </CardTitle>
            <CardDescription className="font-mono text-xs mt-1">
              {storage?.dataDir ?? '~/.clawnet'}
            </CardDescription>
          </div>
          <Badge variant="secondary">{storage?.network ?? 'unknown'}</Badge>
        </CardHeader>
      </Card>

      {/* Databases & Directories */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4" /> Databases
            </CardTitle>
            <CardDescription>SQLite database files</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Path</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(storage?.databases ?? []).map((db) => (
                  <TableRow key={db.name}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Database className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-mono text-xs">{db.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground font-mono">
                      {db.path ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FolderOpen className="h-4 w-4" /> Directories
            </CardTitle>
            <CardDescription>Node data subdirectories</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Path</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(storage?.directories ?? []).map((dir) => (
                  <TableRow key={dir.name}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-mono text-xs">{dir.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground font-mono">
                      {dir.path ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* ── Snapshot Section ───────────────────────────────────── */}
      <Separator />

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
              <Camera className="h-5 w-5" /> Snapshots
            </h2>
            <p className="text-sm text-muted-foreground">
              Point-in-time captures of event-sourced state
            </p>
          </div>
          <Button
            onClick={handleTakeSnapshot}
            disabled={snapshotting}
            className="gap-2"
          >
            {snapshotting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Camera className="h-4 w-4" />
            )}
            Take Snapshot
          </Button>
        </div>

        {/* Snapshot result notification */}
        {snapshotResult && (
          <Alert variant={snapshotResult.created ? 'default' : 'destructive'}>
            {snapshotResult.created ? (
              <Check className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            <AlertDescription>
              {snapshotResult.created
                ? `Snapshot created: ${snapshotResult.hash?.slice(0, 16)}...`
                : snapshotResult.reason ?? 'Snapshot was not created'}
            </AlertDescription>
          </Alert>
        )}

        {/* Latest Snapshot Card */}
        {snapshot ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Latest Snapshot</CardTitle>
              <CardDescription>
                Created {snapshot.createdAt ? new Date(snapshot.createdAt).toLocaleString() : '—'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Snapshot metadata grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <SnapshotField
                  icon={Hash}
                  label="Hash"
                  value={snapshot.hash ?? '—'}
                  truncate
                  copyable
                  onCopy={(v) => copyText(v, 'snap-hash')}
                  copied={copied === 'snap-hash'}
                />
                <SnapshotField
                  icon={Clock}
                  label="Created At"
                  value={
                    snapshot.createdAt
                      ? new Date(snapshot.createdAt).toLocaleString()
                      : '—'
                  }
                />
                <SnapshotField
                  icon={FileKey}
                  label="Signatures"
                  value={String(snapshot.signatures ?? 0)}
                />
                <SnapshotField
                  icon={Layers}
                  label="Version"
                  value={`v${snapshot.version ?? 0}`}
                />
              </div>

              <Separator />

              {/* Event ID & Prev */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground mb-1">Event ID (at)</div>
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono truncate flex-1" title={snapshot.eventId ?? ''}>
                      {snapshot.eventId ?? '—'}
                    </code>
                    {snapshot.eventId && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0"
                        onClick={() => copyText(snapshot.eventId!, 'snap-event')}
                      >
                        {copied === 'snap-event' ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground mb-1">Previous Snapshot</div>
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono truncate flex-1" title={snapshot.prev ?? 'none'}>
                      {snapshot.prev ?? 'none (genesis)'}
                    </code>
                    {snapshot.prev && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0"
                        onClick={() => copyText(snapshot.prev!, 'snap-prev')}
                      >
                        {copied === 'snap-prev' ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* State Keys */}
              {snapshot.stateKeys && snapshot.stateKeys.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <span className="text-xs font-medium text-muted-foreground mb-2 block">
                      State Keys ({snapshot.stateKeys.length})
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {snapshot.stateKeys.map((key) => (
                        <Badge key={key} variant="outline" className="font-mono text-xs">
                          {key}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Camera className="h-12 w-12 text-muted-foreground/20 mb-3" />
              <p className="text-sm font-medium mb-1">No snapshots yet</p>
              <p className="text-xs text-muted-foreground max-w-sm">
                Take a snapshot to capture the current state of node event logs.
                Snapshots are signed and can be shared with other peers for state sync.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────────────── */

function SnapshotField({
  icon: Icon,
  label,
  value,
  truncate: shouldTruncate,
  copyable,
  onCopy,
  copied,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  truncate?: boolean;
  copyable?: boolean;
  onCopy?: (value: string) => void;
  copied?: boolean;
}) {
  const display = shouldTruncate && value.length > 16 ? `${value.slice(0, 16)}...` : value;
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="flex items-center gap-1">
        <span className="text-sm font-medium font-mono truncate" title={value}>
          {display}
        </span>
        {copyable && onCopy && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0"
            onClick={() => onCopy(value)}
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </Button>
        )}
      </div>
    </div>
  );
}
