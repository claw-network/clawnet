import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Lock, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────── */

interface Escrow {
  escrowId: string;
  depositor: string;
  beneficiary: string;
  amount: string;
  status: number;
  expiresAt?: number;
  createdAt?: number;
}

const STATUS_LABELS: Record<number, string> = {
  0: 'Pending',
  1: 'Active',
  2: 'Released',
  3: 'Refunded',
  4: 'Disputed',
};

const STATUS_COLORS: Record<number, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  0: 'outline',
  1: 'default',
  2: 'default',
  3: 'secondary',
  4: 'destructive',
};

/* ── Component ─────────────────────────────────────────────────── */

export function EscrowPage() {
  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const perPage = 20;

  const fetchData = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    try {
      const res = await api.get<{ escrows?: Escrow[]; total?: number } | Escrow[]>(
        `/escrows?page=${page}&perPage=${perPage}`,
      ).catch(() => []);
      if (Array.isArray(res)) {
        setEscrows(res);
        setTotal(res.length);
      } else {
        setEscrows(res?.escrows ?? []);
        setTotal(res?.total ?? 0);
      }
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load escrow data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const performAction = async (escrowId: string, action: string) => {
    try {
      await api.post(`/escrows/${encodeURIComponent(escrowId)}/actions/${action}`);
      fetchData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  };

  const formatDate = (ts?: number) => {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleString();
  };

  const truncateAddr = (addr: string) => {
    if (!addr || addr.length < 12) return addr ?? '—';
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Escrow</h1>
          <p className="text-muted-foreground">On-chain escrow management</p>
        </div>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => fetchData(true)} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Escrow ID</TableHead>
                <TableHead>Depositor</TableHead>
                <TableHead>Beneficiary</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {escrows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No escrows found</TableCell></TableRow>
              ) : escrows.map((e) => (
                <TableRow key={e.escrowId}>
                  <TableCell className="font-mono text-xs">{truncateAddr(e.escrowId)}</TableCell>
                  <TableCell className="font-mono text-xs">{truncateAddr(e.depositor)}</TableCell>
                  <TableCell className="font-mono text-xs">{truncateAddr(e.beneficiary)}</TableCell>
                  <TableCell>{e.amount} Token</TableCell>
                  <TableCell><Badge variant={STATUS_COLORS[e.status] ?? 'outline'}>{STATUS_LABELS[e.status] ?? `${e.status}`}</Badge></TableCell>
                  <TableCell className="text-xs">{formatDate(e.expiresAt)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {e.status === 1 && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => performAction(e.escrowId, 'release')}>Release</Button>
                          <Button size="sm" variant="outline" onClick={() => performAction(e.escrowId, 'refund')}>Refund</Button>
                        </>
                      )}
                      {(e.status === 1 || e.status === 0) && (
                        <Button size="sm" variant="destructive" onClick={() => performAction(e.escrowId, 'dispute')}>Dispute</Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {total > perPage && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">Page {page} of {Math.ceil(total / perPage)}</span>
          <Button variant="outline" size="sm" disabled={page >= Math.ceil(total / perPage)} onClick={() => setPage(page + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
