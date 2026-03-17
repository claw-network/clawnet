import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import { Vote, RefreshCw, Coins, Settings, ChevronLeft, ChevronRight, Plus, ArrowUpCircle } from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────── */

interface Proposal {
  proposalId: number;
  proposer: string;
  pType: number;
  status: number;
  createdAt: number;
  forVotes?: string;
  againstVotes?: string;
  abstainVotes?: string;
}

interface ProposalDetail extends Proposal {
  descriptionHash: string;
  target: string;
  snapshotBlock: number;
  discussionEndAt: number;
  votingEndAt: number;
  timelockEndAt: number;
}

interface Treasury {
  balance: string;
  daoAddress: string;
}

interface GovParam {
  key: string;
  keyHash: string;
  value: string;
}

const STATUS_LABELS: Record<number, string> = {
  0: 'Discussion',
  1: 'Voting',
  2: 'Passed',
  3: 'Rejected',
  4: 'Timelocked',
  5: 'Executed',
  6: 'Cancelled',
  7: 'Expired',
};

const STATUS_COLORS: Record<number, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  0: 'outline',
  1: 'default',
  2: 'default',
  3: 'destructive',
  4: 'secondary',
  5: 'default',
  6: 'destructive',
  7: 'secondary',
};

const TYPE_LABELS: Record<number, string> = {
  0: 'Parameter Change',
  1: 'Treasury Spend',
  2: 'Protocol Upgrade',
  3: 'Emergency',
  4: 'Signal',
};

/* ── Component ─────────────────────────────────────────────────── */

export function GovernancePage() {
  const [tab, setTab] = useState<'proposals' | 'treasury' | 'parameters' | 'upgrades'>('proposals');
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [treasury, setTreasury] = useState<Treasury | null>(null);
  const [params, setParams] = useState<GovParam[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedProposal, setSelectedProposal] = useState<ProposalDetail | null>(null);
  const [statusFilter, setStatusFilter] = useState<number | null>(null);

  // Create proposal dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createForm, setCreateForm] = useState({
    type: 'parameter_change' as string,
    title: '',
    description: '',
    target: '',
    callData: '',
  });

  const perPage = 20;

  // Parameter change dialog
  const [paramDialogOpen, setParamDialogOpen] = useState(false);
  const [paramKey, setParamKey] = useState('');
  const [paramNewValue, setParamNewValue] = useState('');
  const [paramDesc, setParamDesc] = useState('');
  const [paramSubmitting, setParamSubmitting] = useState(false);
  const [paramResult, setParamResult] = useState('');

  // Treasury transfer proposal
  const [treasuryTo, setTreasuryTo] = useState('');
  const [treasuryAmount, setTreasuryAmount] = useState('');
  const [treasuryDesc, setTreasuryDesc] = useState('');
  const [treasurySubmitting, setTreasurySubmitting] = useState(false);
  const [treasuryResult, setTreasuryResult] = useState('');

  // Treasury deposit
  const [depositAmount, setDepositAmount] = useState('');
  const [depositing, setDepositing] = useState(false);
  const [depositResult, setDepositResult] = useState('');

  // Upgrade proposal
  const [upgradeContract, setUpgradeContract] = useState('');
  const [upgradeImpl, setUpgradeImpl] = useState('');
  const [upgradeDesc, setUpgradeDesc] = useState('');
  const [upgradeSubmitting, setUpgradeSubmitting] = useState(false);
  const [upgradeResult, setUpgradeResult] = useState('');

  const fetchData = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    try {
      let proposalsUrl = `/dao/proposals?page=${page}&perPage=${perPage}`;
      if (statusFilter !== null) proposalsUrl += `&status=${statusFilter}`;
      const [proposalRes, treasuryRes, paramsRes] = await Promise.all([
        api.get<{ proposals?: Proposal[]; total?: number } | Proposal[]>(
          proposalsUrl,
        ).catch(() => []),
        api.get<Treasury>('/dao/treasury').catch(() => null),
        api.get<{ params?: GovParam[] }>('/dao/params').catch(() => null),
      ]);

      if (Array.isArray(proposalRes)) {
        setProposals(proposalRes);
        setTotal(proposalRes.length);
      } else {
        setProposals(proposalRes?.proposals ?? []);
        setTotal(proposalRes?.total ?? 0);
      }
      setTreasury(treasuryRes);
      setParams(paramsRes?.params ?? []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load governance data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fetchProposalDetail = async (id: number) => {
    try {
      const detail = await api.get<ProposalDetail>(`/dao/proposals/${id}`);
      setSelectedProposal(detail);
    } catch {
      // ignore
    }
  };

  const advanceProposal = async (id: number, newStatus: string) => {
    try {
      await api.post(`/dao/proposals/${id}/actions/advance`, { newStatus });
      fetchData(true);
      setSelectedProposal(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  };

  const castVote = async (id: number, option: string) => {
    try {
      await api.post(`/dao/proposals/${id}/votes`, { option });
      fetchData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vote failed');
    }
  };

  const handleCreateProposal = async () => {
    if (!createForm.title || !createForm.description) return;
    setCreateLoading(true);
    setSuccess('');
    try {
      await api.post('/dao/proposals', {
        type: createForm.type,
        title: createForm.title,
        description: createForm.description,
        actions: [{ target: createForm.target || '0x0000000000000000000000000000000000000000', callData: createForm.callData || '0x' }],
      });
      setSuccess('Proposal created');
      setCreateOpen(false);
      setCreateForm({ type: 'parameter_change', title: '', description: '', target: '', callData: '' });
      fetchData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create proposal');
    } finally {
      setCreateLoading(false);
    }
  };

  const openProposeChange = (key: string, currentValue: string) => {
    setParamKey(key);
    setParamNewValue('');
    setParamDesc(`Change parameter "${key}" from ${currentValue}`);
    setParamResult('');
    setParamDialogOpen(true);
  };

  const handleParamChange = async () => {
    if (!paramKey || !paramNewValue || !paramDesc) return;
    setParamSubmitting(true);
    setParamResult('');
    try {
      const result = await api.post<{ proposalId?: number; txHash?: string }>('/dao/proposals/param-change', {
        paramName: paramKey,
        newValue: parseInt(paramNewValue, 10),
        description: paramDesc,
      });
      setParamResult(`Proposal #${result?.proposalId} created! TX: ${result?.txHash ?? 'success'}`);
      setParamDialogOpen(false);
      fetchData(true);
    } catch (err) {
      setParamResult(err instanceof Error ? err.message : 'Failed to create param change proposal');
    } finally {
      setParamSubmitting(false);
    }
  };

  const handleTreasuryTransfer = async () => {
    if (!treasuryTo || !treasuryAmount || !treasuryDesc) return;
    setTreasurySubmitting(true);
    setTreasuryResult('');
    try {
      const result = await api.post<{ proposalId?: number; txHash?: string }>('/dao/proposals/treasury-transfer', {
        to: treasuryTo,
        amount: parseInt(treasuryAmount, 10),
        description: treasuryDesc,
      });
      setTreasuryResult(`Proposal #${result?.proposalId} created! TX: ${result?.txHash ?? 'success'}`);
      setTreasuryTo('');
      setTreasuryAmount('');
      setTreasuryDesc('');
      fetchData(true);
    } catch (err) {
      setTreasuryResult(err instanceof Error ? err.message : 'Failed to create treasury proposal');
    } finally {
      setTreasurySubmitting(false);
    }
  };

  const handleDeposit = async () => {
    if (!depositAmount) return;
    setDepositing(true);
    setDepositResult('');
    try {
      const result = await api.post<{ txHash?: string }>('/dao/treasury/deposits', {
        amount: parseInt(depositAmount, 10),
      });
      setDepositResult(`Deposited! TX: ${result?.txHash ?? 'success'}`);
      setDepositAmount('');
      fetchData(true);
    } catch (err) {
      setDepositResult(err instanceof Error ? err.message : 'Deposit failed');
    } finally {
      setDepositing(false);
    }
  };

  const handleUpgradeProposal = async () => {
    if (!upgradeContract || !upgradeImpl || !upgradeDesc) return;
    setUpgradeSubmitting(true);
    setUpgradeResult('');
    try {
      const result = await api.post<{ proposalId?: number; txHash?: string }>('/dao/proposals/upgrade', {
        contract: upgradeContract,
        newImplementation: upgradeImpl,
        description: upgradeDesc,
      });
      setUpgradeResult(`Proposal #${result?.proposalId} created! TX: ${result?.txHash ?? 'success'}`);
      setUpgradeContract('');
      setUpgradeImpl('');
      setUpgradeDesc('');
      fetchData(true);
    } catch (err) {
      setUpgradeResult(err instanceof Error ? err.message : 'Failed to create upgrade proposal');
    } finally {
      setUpgradeSubmitting(false);
    }
  };

  const formatDate = (ts: number) => {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleString();
  };

  const formatRelative = (ts: number) => {
    if (!ts) return '';
    const diffSec = ts - Math.floor(Date.now() / 1000);
    const abs = Math.abs(diffSec);
    if (abs < 60) return diffSec > 0 ? 'in <1 min' : 'just elapsed';
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    const parts = h > 0 ? `${h}h ${m}m` : `${m}m`;
    return diffSec > 0 ? `in ${parts}` : `${parts} ago`;
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
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Governance</h1>
          <p className="text-muted-foreground">DAO proposals, treasury, and parameters</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-1 h-4 w-4" /> New Proposal</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Proposal</DialogTitle>
                <DialogDescription>Submit a new governance proposal to the DAO.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <Field>
                  <FieldLabel>Type</FieldLabel>
                  <div className="flex flex-wrap gap-1">
                    {(['parameter_change', 'treasury_spend', 'protocol_upgrade', 'emergency', 'signal'] as const).map((t) => (
                      <Button key={t} size="sm" variant={createForm.type === t ? 'default' : 'outline'} onClick={() => setCreateForm({ ...createForm, type: t })}>
                        {t.replace('_', ' ')}
                      </Button>
                    ))}
                  </div>
                </Field>
                <Field>
                  <FieldLabel htmlFor="propTitle">Title</FieldLabel>
                  <Input id="propTitle" placeholder="Proposal title" value={createForm.title} onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="propDesc">Description</FieldLabel>
                  <Input id="propDesc" placeholder="Proposal description" value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="propTarget">Target Address (optional)</FieldLabel>
                  <Input id="propTarget" placeholder="0x..." value={createForm.target} onChange={(e) => setCreateForm({ ...createForm, target: e.target.value })} />
                </Field>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button onClick={handleCreateProposal} disabled={createLoading || !createForm.title || !createForm.description}>
                  {createLoading ? 'Creating…' : 'Create'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => fetchData(true)} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {success && <Alert><AlertDescription>{success}</AlertDescription></Alert>}

      {/* Tabs */}
      <div className="flex gap-2 border-b pb-2">
        {(['proposals', 'treasury', 'parameters', 'upgrades'] as const).map((t) => (
          <Button
            key={t}
            variant={tab === t ? 'default' : 'ghost'}
            size="sm"
            onClick={() => { setTab(t); setSelectedProposal(null); }}
          >
            {t === 'proposals' && <Vote className="mr-1 h-4 w-4" />}
            {t === 'treasury' && <Coins className="mr-1 h-4 w-4" />}
            {t === 'parameters' && <Settings className="mr-1 h-4 w-4" />}
            {t === 'upgrades' && <ArrowUpCircle className="mr-1 h-4 w-4" />}
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </Button>
        ))}
      </div>

      {/* Proposals Tab */}
      {tab === 'proposals' && !selectedProposal && (
        <div className="space-y-4">
          {/* Status Filter */}
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant={statusFilter === null ? 'default' : 'ghost'} onClick={() => { setStatusFilter(null); setPage(1); }}>All</Button>
            {Object.entries(STATUS_LABELS).map(([k, label]) => (
              <Button key={k} size="sm" variant={statusFilter === Number(k) ? 'default' : 'ghost'} onClick={() => { setStatusFilter(Number(k)); setPage(1); }}>
                {label}
              </Button>
            ))}
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">ID</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Proposer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-24">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {proposals.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No proposals found</TableCell></TableRow>
                  ) : proposals.map((p) => (
                    <TableRow key={p.proposalId} className="cursor-pointer" onClick={() => fetchProposalDetail(p.proposalId)}>
                      <TableCell className="font-mono">#{p.proposalId}</TableCell>
                      <TableCell>{TYPE_LABELS[p.pType] ?? `Type ${p.pType}`}</TableCell>
                      <TableCell className="font-mono text-xs">{truncateAddr(p.proposer)}</TableCell>
                      <TableCell><Badge variant={STATUS_COLORS[p.status] ?? 'outline'}>{STATUS_LABELS[p.status] ?? `Status ${p.status}`}</Badge></TableCell>
                      <TableCell className="text-xs">{formatDate(p.createdAt)}</TableCell>
                      <TableCell>
                        {p.status === 1 && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); castVote(p.proposalId, 'for'); }}>For</Button>
                            <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); castVote(p.proposalId, 'against'); }}>Against</Button>
                          </div>
                        )}
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
      )}

      {/* Proposal Detail */}
      {tab === 'proposals' && selectedProposal && (
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={() => setSelectedProposal(null)}>
            <ChevronLeft className="mr-1 h-4 w-4" /> Back to list
          </Button>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Proposal #{selectedProposal.proposalId}
                <Badge variant={STATUS_COLORS[selectedProposal.status] ?? 'outline'}>
                  {STATUS_LABELS[selectedProposal.status] ?? `Status ${selectedProposal.status}`}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-muted-foreground">Type:</span> {TYPE_LABELS[selectedProposal.pType]}</div>
                <div><span className="text-muted-foreground">Proposer:</span> <span className="font-mono">{truncateAddr(selectedProposal.proposer)}</span></div>
                <div><span className="text-muted-foreground">Target:</span> <span className="font-mono">{truncateAddr(selectedProposal.target)}</span></div>
                <div><span className="text-muted-foreground">Snapshot Block:</span> {selectedProposal.snapshotBlock}</div>
                <div><span className="text-muted-foreground">Created:</span> {formatDate(selectedProposal.createdAt)}</div>
                <div><span className="text-muted-foreground">Discussion End:</span>{' '}{formatDate(selectedProposal.discussionEndAt)}{' '}<span className="text-xs text-muted-foreground">({formatRelative(selectedProposal.discussionEndAt)})</span></div>
                <div><span className="text-muted-foreground">Voting End:</span> {formatDate(selectedProposal.votingEndAt)}</div>
                <div><span className="text-muted-foreground">Timelock End:</span> {formatDate(selectedProposal.timelockEndAt)}</div>
              </div>
              <div className="grid grid-cols-3 gap-4 pt-3 border-t">
                <div className="text-center">
                  <div className="text-lg font-bold text-green-600">{selectedProposal.forVotes ?? '0'}</div>
                  <div className="text-xs text-muted-foreground">For</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-red-600">{selectedProposal.againstVotes ?? '0'}</div>
                  <div className="text-xs text-muted-foreground">Against</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-muted-foreground">{selectedProposal.abstainVotes ?? '0'}</div>
                  <div className="text-xs text-muted-foreground">Abstain</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-3 border-t">
                {selectedProposal.status === 0 && selectedProposal.discussionEndAt > 0 && Math.floor(Date.now() / 1000) < selectedProposal.discussionEndAt && (
                  <p className="w-full text-xs text-muted-foreground">
                    Voting opens {formatRelative(selectedProposal.discussionEndAt)} — discussion period must elapse first.
                  </p>
                )}
                {(selectedProposal.status === 1 || (selectedProposal.status === 0 && selectedProposal.discussionEndAt > 0 && Math.floor(Date.now() / 1000) >= selectedProposal.discussionEndAt)) && (
                  <>
                    {selectedProposal.status === 0 && (
                      <p className="w-full text-xs text-amber-600">Discussion period elapsed — your vote will advance this proposal to Voting.</p>
                    )}
                    <Button size="sm" onClick={() => castVote(selectedProposal.proposalId, 'for')}>Vote For</Button>
                    <Button size="sm" variant="outline" onClick={() => castVote(selectedProposal.proposalId, 'against')}>Vote Against</Button>
                    <Button size="sm" variant="ghost" onClick={() => castVote(selectedProposal.proposalId, 'abstain')}>Abstain</Button>
                  </>
                )}
                {selectedProposal.status === 2 && (
                  <Button size="sm" onClick={() => advanceProposal(selectedProposal.proposalId, 'queued')}>Queue for Execution</Button>
                )}
                {selectedProposal.status === 4 && (
                  <Button size="sm" onClick={() => advanceProposal(selectedProposal.proposalId, 'executed')}>Execute</Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Treasury Tab */}
      {tab === 'treasury' && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Treasury Balance</CardTitle>
                <Coins className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{treasury?.balance ?? '—'} Token</div>
                <p className="text-xs text-muted-foreground mt-1 font-mono">{treasury?.daoAddress ?? '—'}</p>
              </CardContent>
            </Card>

            {/* Deposit */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Deposit to Treasury</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Field><FieldLabel>Amount</FieldLabel><Input type="number" placeholder="1000" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} /></Field>
                <Button onClick={handleDeposit} disabled={depositing || !depositAmount}>{depositing ? 'Depositing…' : 'Deposit'}</Button>
                {depositResult && <p className="text-xs text-muted-foreground">{depositResult}</p>}
              </CardContent>
            </Card>
          </div>

          {/* Treasury Transfer Proposal */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Propose Treasury Transfer (via DAO)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-3">
                <Field><FieldLabel>To Address</FieldLabel><Input placeholder="0x…" value={treasuryTo} onChange={(e) => setTreasuryTo(e.target.value)} /></Field>
                <Field><FieldLabel>Amount</FieldLabel><Input type="number" placeholder="500" value={treasuryAmount} onChange={(e) => setTreasuryAmount(e.target.value)} /></Field>
                <Field><FieldLabel>Description</FieldLabel><Input placeholder="Payment for…" value={treasuryDesc} onChange={(e) => setTreasuryDesc(e.target.value)} /></Field>
              </div>
              <Button onClick={handleTreasuryTransfer} disabled={treasurySubmitting || !treasuryTo || !treasuryAmount || !treasuryDesc}>
                {treasurySubmitting ? 'Creating…' : 'Create Treasury Proposal'}
              </Button>
              {treasuryResult && <p className="text-xs text-muted-foreground">{treasuryResult}</p>}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Parameters Tab */}
      {tab === 'parameters' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Parameter</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead className="w-48">Key Hash</TableHead>
                    <TableHead className="w-32">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {params.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No parameters configured</TableCell></TableRow>
                  ) : params.map((p) => (
                    <TableRow key={p.keyHash}>
                      <TableCell className="font-medium">{p.key}</TableCell>
                      <TableCell className="font-mono">{p.value}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{truncateAddr(p.keyHash)}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => openProposeChange(p.key, p.value)}>
                          Propose Change
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Param Change Dialog */}
          <Dialog open={paramDialogOpen} onOpenChange={setParamDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Propose Parameter Change</DialogTitle>
                <DialogDescription>Create a DAO proposal to change "{paramKey}"</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <Field>
                  <FieldLabel>Parameter</FieldLabel>
                  <Input value={paramKey} disabled />
                </Field>
                <Field>
                  <FieldLabel>New Value</FieldLabel>
                  <Input type="number" placeholder="Enter new value" value={paramNewValue} onChange={(e) => setParamNewValue(e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel>Description</FieldLabel>
                  <Input placeholder="Reason for change" value={paramDesc} onChange={(e) => setParamDesc(e.target.value)} />
                </Field>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setParamDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleParamChange} disabled={paramSubmitting || !paramNewValue || !paramDesc}>
                  {paramSubmitting ? 'Creating…' : 'Create Proposal'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {paramResult && <Alert><AlertDescription>{paramResult}</AlertDescription></Alert>}
        </div>
      )}

      {/* Upgrades Tab */}
      {tab === 'upgrades' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowUpCircle className="h-4 w-4" /> Propose Contract Upgrade
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <Field>
                <FieldLabel>Contract</FieldLabel>
                <Select value={upgradeContract} onValueChange={setUpgradeContract}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select contract…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {['token', 'identity', 'escrow', 'staking', 'reputation', 'dao', 'contracts', 'router', 'relayReward', 'paramRegistry'].map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>New Implementation Address</FieldLabel>
                <Input placeholder="0x…" value={upgradeImpl} onChange={(e) => setUpgradeImpl(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel>Description</FieldLabel>
                <Input placeholder="Upgrade reason" value={upgradeDesc} onChange={(e) => setUpgradeDesc(e.target.value)} />
              </Field>
            </div>
            <Button onClick={handleUpgradeProposal} disabled={upgradeSubmitting || !upgradeContract || !upgradeImpl || !upgradeDesc}>
              {upgradeSubmitting ? 'Creating…' : 'Create Upgrade Proposal'}
            </Button>
            {upgradeResult && <p className="text-xs text-muted-foreground">{upgradeResult}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
