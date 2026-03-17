import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { PieChart, RefreshCw, Wallet, Landmark, Layers, Copy, Check, ExternalLink } from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────── */

interface TokenDistribution {
  treasury: { address: string; balance: string };
  staking: { address: string; balance: string };
  signer: { address: string; balance: string };
}

interface Treasury {
  balance: string;
  daoAddress: string;
}

interface TokenSupply {
  totalSupply: string;
}

interface FundMovement {
  txHash: string;
  from: string;
  to: string;
  amount: string;
  type?: string;
  timestamp?: number;
  blockNumber?: number;
}

/* ── Component ─────────────────────────────────────────────────── */

export function EcosystemPage() {
  const [distribution, setDistribution] = useState<TokenDistribution | null>(null);
  const [treasury, setTreasury] = useState<Treasury | null>(null);
  const [supply, setSupply] = useState<TokenSupply | null>(null);
  const [movements, setMovements] = useState<FundMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [selectedMovement, setSelectedMovement] = useState<FundMovement | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const fetchData = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    try {
      const [distRes, treasuryRes, supplyRes] = await Promise.all([
        api.get<TokenDistribution>('/token/distribution').catch(() => null),
        api.get<Treasury>('/dao/treasury').catch(() => null),
        api.get<TokenSupply>('/token/supply').catch(() => null),
      ]);
      setDistribution(distRes);
      setTreasury(treasuryRes);
      setSupply(supplyRes);

      // Fetch recent fund movements from treasury address
      const treasuryAddr = treasuryRes?.daoAddress ?? distRes?.treasury?.address;
      if (treasuryAddr) {
        try {
          const txRes = await api.get<{ transactions?: FundMovement[] } | FundMovement[]>(
            `/wallets/${encodeURIComponent(treasuryAddr)}/transactions?page=1&perPage=10`,
          );
          if (Array.isArray(txRes)) {
            setMovements(txRes);
          } else {
            setMovements(txRes?.transactions ?? []);
          }
        } catch {
          // transactions may not be available
        }
      }

      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ecosystem data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const truncateAddr = (addr: string) => {
    if (!addr || addr.length < 12) return addr ?? '—';
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  };

  const calcPercent = (balance: string, total: string) => {
    const b = Number(balance);
    const t = Number(total);
    if (!t) return '0';
    return ((b / t) * 100).toFixed(1);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-36" /><Skeleton className="h-36" /><Skeleton className="h-36" /></div>
      </div>
    );
  }

  const totalSupply = supply?.totalSupply ?? '0';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ecosystem</h1>
          <p className="text-muted-foreground">Treasury, staking pool, and fund distribution overview</p>
        </div>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => fetchData(true)} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      {/* Total Supply */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">Total Token Supply</CardTitle>
          <PieChart className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{totalSupply} Token</div>
        </CardContent>
      </Card>

      {/* Fund Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">DAO Treasury</CardTitle>
            <Landmark className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{treasury?.balance ?? distribution?.treasury.balance ?? '—'} Token</div>
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-muted-foreground font-mono">{truncateAddr(treasury?.daoAddress ?? distribution?.treasury.address ?? '')}</p>
              <span className="text-xs text-muted-foreground">
                {calcPercent(treasury?.balance ?? distribution?.treasury.balance ?? '0', totalSupply)}%
              </span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full"
                style={{ width: `${Math.min(Number(calcPercent(treasury?.balance ?? distribution?.treasury.balance ?? '0', totalSupply)), 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Staking Pool</CardTitle>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{distribution?.staking.balance ?? '—'} Token</div>
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-muted-foreground font-mono">{truncateAddr(distribution?.staking.address ?? '')}</p>
              <span className="text-xs text-muted-foreground">
                {calcPercent(distribution?.staking.balance ?? '0', totalSupply)}%
              </span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full"
                style={{ width: `${Math.min(Number(calcPercent(distribution?.staking.balance ?? '0', totalSupply)), 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Node Signer</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{distribution?.signer.balance ?? '—'} Token</div>
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-muted-foreground font-mono">{truncateAddr(distribution?.signer.address ?? '')}</p>
              <span className="text-xs text-muted-foreground">
                {calcPercent(distribution?.signer.balance ?? '0', totalSupply)}%
              </span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-orange-500 rounded-full"
                style={{ width: `${Math.min(Number(calcPercent(distribution?.signer.balance ?? '0', totalSupply)), 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Fund Movements */}
      {movements.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Fund Movements</CardTitle>
            <CardDescription>Click a row to see full transaction details</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tx Hash</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((m, i) => (
                  <TableRow
                    key={m.txHash || i}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedMovement(m)}
                  >
                    <TableCell className="font-mono text-xs">{truncateAddr(m.txHash ?? '')}</TableCell>
                    <TableCell className="font-mono text-xs">{truncateAddr(m.from)}</TableCell>
                    <TableCell className="font-mono text-xs">{truncateAddr(m.to)}</TableCell>
                    <TableCell>{m.amount} Token</TableCell>
                    <TableCell>
                      <Badge variant="outline">{m.type ?? 'transfer'}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Fund Movement Detail Dialog */}
      <Dialog open={!!selectedMovement} onOpenChange={(open) => { if (!open) setSelectedMovement(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ExternalLink className="h-4 w-4" />
              Transaction Details
            </DialogTitle>
          </DialogHeader>
          {selectedMovement && (
            <div className="space-y-3 text-sm">
              {([
                { label: 'Tx Hash', value: selectedMovement.txHash ?? '—' },
                { label: 'From',    value: selectedMovement.from },
                { label: 'To',      value: selectedMovement.to },
              ] as { label: string; value: string }[]).map(({ label, value }) => (
                <div key={label}>
                  <p className="text-xs text-muted-foreground mb-1">{label}</p>
                  <div className="flex items-center gap-2 bg-muted rounded px-3 py-2">
                    <span className="font-mono text-xs break-all flex-1">{value}</span>
                    <button
                      className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => copyToClipboard(value, `mv-${label}`)}
                    >
                      {copied === `mv-${label}`
                        ? <Check className="h-3.5 w-3.5 text-green-500" />
                        : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              ))}
              <div className="grid grid-cols-3 gap-3 pt-1">
                <div className="bg-muted rounded px-3 py-2">
                  <p className="text-xs text-muted-foreground mb-1">Amount</p>
                  <p className="font-semibold">{selectedMovement.amount} Token</p>
                </div>
                <div className="bg-muted rounded px-3 py-2">
                  <p className="text-xs text-muted-foreground mb-1">Type</p>
                  <Badge variant="outline">{selectedMovement.type ?? 'transfer'}</Badge>
                </div>
                <div className="bg-muted rounded px-3 py-2">
                  <p className="text-xs text-muted-foreground mb-1">Block</p>
                  <p className="font-mono text-xs">{selectedMovement.blockNumber ?? '—'}</p>
                </div>
              </div>
              {selectedMovement.timestamp && (
                <div className="bg-muted rounded px-3 py-2">
                  <p className="text-xs text-muted-foreground mb-1">Timestamp</p>
                  <p className="text-xs">{new Date(selectedMovement.timestamp * 1000).toLocaleString()}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
