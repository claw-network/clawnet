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
import { FileCheck, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────── */

interface ServiceContract {
  contractId: string;
  client: string;
  provider: string;
  status: number;
  amount: string;
  createdAt: number;
  deadline?: number;
  title?: string;
  milestoneCount?: number;
}

interface ContractDetail extends ServiceContract {
  description?: string;
  milestones?: Milestone[];
  arbiter?: string;
  escrowId?: string;
}

interface Milestone {
  id: number;
  description: string;
  amount: string;
  status: number;
  deadline?: number;
}

const STATUS_LABELS: Record<number, string> = {
  0: 'Draft',
  1: 'Active',
  2: 'Completed',
  3: 'Disputed',
  4: 'Cancelled',
};

const STATUS_COLORS: Record<number, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  0: 'outline',
  1: 'default',
  2: 'default',
  3: 'destructive',
  4: 'secondary',
};

/* ── Component ─────────────────────────────────────────────────── */

export function ContractsPage() {
  const [contracts, setContracts] = useState<ServiceContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<ContractDetail | null>(null);
  const [statusFilter, setStatusFilter] = useState<number | null>(null);

  const perPage = 20;

  const fetchData = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    try {
      let url = `/contracts?page=${page}&perPage=${perPage}`;
      if (statusFilter !== null) url += `&status=${statusFilter}`;
      const res = await api.get<{ contracts?: ServiceContract[]; total?: number } | ServiceContract[]>(url).catch(() => []);
      if (Array.isArray(res)) {
        setContracts(res);
        setTotal(res.length);
      } else {
        setContracts(res?.contracts ?? []);
        setTotal(res?.total ?? 0);
      }
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contracts');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fetchDetail = async (id: string) => {
    try {
      const detail = await api.get<ContractDetail>(`/contracts/${encodeURIComponent(id)}`);
      setSelected(detail);
    } catch {
      // ignore
    }
  };

  const milestoneAction = async (contractId: string, milestoneIdx: number, action: string) => {
    try {
      await api.post(`/contracts/${encodeURIComponent(contractId)}/milestones/${milestoneIdx}/actions/${action}`, {});
      // Refresh detail
      fetchDetail(contractId);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`);
    }
  };

  const contractAction = async (contractId: string, action: string) => {
    try {
      await api.post(`/contracts/${encodeURIComponent(contractId)}/actions/${action}`, {});
      fetchDetail(contractId);
      fetchData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`);
    }
  };

  const formatDate = (ts: number) => {
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
          <h1 className="text-2xl font-bold tracking-tight">Service Contracts</h1>
          <p className="text-muted-foreground">On-chain service contract lifecycle management</p>
        </div>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => fetchData(true)} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      {/* Status Filters */}
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" variant={statusFilter === null ? 'default' : 'ghost'} onClick={() => { setStatusFilter(null); setPage(1); }}>All</Button>
        {Object.entries(STATUS_LABELS).map(([k, label]) => (
          <Button key={k} size="sm" variant={statusFilter === Number(k) ? 'default' : 'ghost'} onClick={() => { setStatusFilter(Number(k)); setPage(1); }}>
            {label}
          </Button>
        ))}
      </div>

      {/* Contract List */}
      {!selected && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No contracts found</TableCell></TableRow>
                ) : contracts.map((c) => (
                  <TableRow key={c.contractId} className="cursor-pointer" onClick={() => fetchDetail(c.contractId)}>
                    <TableCell className="font-mono text-xs">{truncateAddr(c.contractId)}</TableCell>
                    <TableCell className="font-mono text-xs">{truncateAddr(c.client)}</TableCell>
                    <TableCell className="font-mono text-xs">{truncateAddr(c.provider)}</TableCell>
                    <TableCell>{c.amount} Token</TableCell>
                    <TableCell><Badge variant={STATUS_COLORS[c.status] ?? 'outline'}>{STATUS_LABELS[c.status] ?? `${c.status}`}</Badge></TableCell>
                    <TableCell className="text-xs">{formatDate(c.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {!selected && total > perPage && (
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

      {/* Contract Detail */}
      {selected && (
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
            <ChevronLeft className="mr-1 h-4 w-4" /> Back to list
          </Button>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileCheck className="h-5 w-5" />
                Contract: <span className="font-mono text-sm">{truncateAddr(selected.contractId)}</span>
                <Badge variant={STATUS_COLORS[selected.status] ?? 'outline'}>{STATUS_LABELS[selected.status]}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-muted-foreground">Client:</span> <span className="font-mono">{truncateAddr(selected.client)}</span></div>
                <div><span className="text-muted-foreground">Provider:</span> <span className="font-mono">{truncateAddr(selected.provider)}</span></div>
                <div><span className="text-muted-foreground">Amount:</span> {selected.amount} Token</div>
                <div><span className="text-muted-foreground">Created:</span> {formatDate(selected.createdAt)}</div>
                {selected.deadline && <div><span className="text-muted-foreground">Deadline:</span> {formatDate(selected.deadline)}</div>}
                {selected.arbiter && <div><span className="text-muted-foreground">Arbiter:</span> <span className="font-mono">{truncateAddr(selected.arbiter)}</span></div>}
              </div>

              {/* Milestones */}
              {selected.milestones && selected.milestones.length > 0 && (
                <div className="pt-3 border-t">
                  <h3 className="text-sm font-semibold mb-2">Milestones</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">#</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-48">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selected.milestones.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell>{m.id}</TableCell>
                          <TableCell>{m.description}</TableCell>
                          <TableCell>{m.amount} Token</TableCell>
                          <TableCell>
                            <Badge variant={m.status === 2 ? 'default' : 'outline'}>
                              {m.status === 0 ? 'Pending' : m.status === 1 ? 'Submitted' : m.status === 2 ? 'Approved' : m.status === 3 ? 'Rejected' : `${m.status}`}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {m.status === 0 && (
                                <Button size="sm" variant="outline" onClick={() => milestoneAction(selected.contractId, m.id, 'submit')}>Submit</Button>
                              )}
                              {m.status === 1 && (
                                <>
                                  <Button size="sm" variant="outline" onClick={() => milestoneAction(selected.contractId, m.id, 'approve')}>Approve</Button>
                                  <Button size="sm" variant="ghost" onClick={() => milestoneAction(selected.contractId, m.id, 'reject')}>Reject</Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Contract Actions */}
              <div className="flex gap-2 pt-3 border-t">
                {selected.status === 0 && (
                  <>
                    <Button size="sm" onClick={() => contractAction(selected.contractId, 'sign')}>Sign</Button>
                    <Button size="sm" variant="outline" onClick={() => contractAction(selected.contractId, 'activate')}>Activate</Button>
                  </>
                )}
                {selected.status === 1 && (
                  <>
                    <Button size="sm" onClick={() => contractAction(selected.contractId, 'complete')}>Complete</Button>
                    <Button size="sm" variant="outline" onClick={() => contractAction(selected.contractId, 'dispute')}>Dispute</Button>
                    <Button size="sm" variant="ghost" onClick={() => contractAction(selected.contractId, 'terminate')}>Terminate</Button>
                  </>
                )}
                {selected.status === 3 && (
                  <Button size="sm" onClick={() => contractAction(selected.contractId, 'resolve')}>Resolve Dispute</Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
