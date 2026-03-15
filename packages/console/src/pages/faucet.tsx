import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import { Droplets, Clock, Coins, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';

interface FaucetStatus {
  enabled?: boolean;
  amount?: number;
  cooldown?: number;
  totalClaims?: number;
  [key: string]: unknown;
}

interface FaucetStats {
  totalClaims: number;
  totalDistributed: number;
  todayDistributed: number;
}

interface FaucetClaim {
  did: string;
  address: string;
  amount: number;
  txHash: string | null;
  claimedAt: string;
}

export function FaucetPage() {
  const [status, setStatus] = useState<FaucetStatus | null>(null);
  const [stats, setStats] = useState<FaucetStats | null>(null);
  const [claims, setClaims] = useState<FaucetClaim[]>([]);
  const [claimsTotal, setClaimsTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const perPage = 20;

  const fetchData = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    try {
      const [statsRes, claimsRes] = await Promise.all([
        api.get<FaucetStats>('/faucet/stats').catch(() => null),
        api.get<FaucetClaim[] | { data?: FaucetClaim[]; meta?: { total?: number } }>(`/faucet/claims?page=${page}&perPage=${perPage}`).catch(() => []),
      ]);
      setStatus(statsRes ? { enabled: true, totalClaims: statsRes.totalClaims } : null);
      setStats(statsRes);
      if (claimsRes && typeof claimsRes === 'object' && 'data' in claimsRes) {
        const envelope = claimsRes as { data?: FaucetClaim[]; meta?: { total?: number } };
        setClaims(envelope.data ?? []);
        setClaimsTotal(envelope.meta?.total ?? (envelope.data?.length ?? 0));
      } else if (Array.isArray(claimsRes)) {
        setClaims(claimsRes);
        setClaimsTotal(claimsRes.length);
      } else {
        setClaims([]);
        setClaimsTotal(0);
      }
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load faucet info');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const truncateDid = (did: string) => {
    if (!did || did.length < 20) return did ?? '—';
    return `${did.slice(0, 16)}…${did.slice(-6)}`;
  };

  const truncateAddr = (addr: string) => {
    if (!addr || addr.length < 12) return addr ?? '—';
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  };

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Faucet</h1>
          <p className="text-muted-foreground">Token faucet configuration, stats, and claim history</p>
        </div>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => fetchData(true)} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {stats && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Claims</CardTitle>
              <Droplets className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalClaims.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">All-time claims</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Distributed</CardTitle>
              <Coins className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalDistributed.toLocaleString()} Tokens</div>
              <p className="text-xs text-muted-foreground">All-time distribution</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Today Distributed</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.todayDistributed.toLocaleString()} Tokens</div>
              <p className="text-xs text-muted-foreground">Distributed today</p>
            </CardContent>
          </Card>
        </div>
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

      <Card>
        <CardHeader>
          <CardTitle>Claim History</CardTitle>
          <CardDescription>Recent faucet claims</CardDescription>
        </CardHeader>
        <CardContent>
          {claims.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No claims recorded</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>DID</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Tx Hash</TableHead>
                    <TableHead>Claimed At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {claims.map((c, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{truncateDid(c.did)}</TableCell>
                      <TableCell className="font-mono text-xs">{truncateAddr(c.address)}</TableCell>
                      <TableCell>{c.amount}</TableCell>
                      <TableCell className="font-mono text-xs">{c.txHash ? truncateAddr(c.txHash) : '—'}</TableCell>
                      <TableCell className="text-xs">{new Date(c.claimedAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between pt-4">
                <span className="text-sm text-muted-foreground">{claimsTotal} total claims</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm leading-8">Page {page}</span>
                  <Button variant="outline" size="sm" disabled={claims.length < perPage} onClick={() => setPage((p) => p + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
