import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { Layers, RefreshCw, Users, Clock, Coins, Zap, Plus, ArrowDown, Gift } from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────── */

interface StakingInfo {
  totalStaked: string;
  activeValidatorCount: number;
  minStake: string;
  unstakeCooldown: number;
  rewardPerEpoch: string;
  slashPerViolation: string;
}

interface StakerView {
  address: string;
  staked: string;
  nodeType: number;
  pendingRewards: string;
  unstakeRequestTime: number;
  isActive: boolean;
}

interface ValidatorsResponse {
  validators: string[];
  count: number;
}

interface TxResult {
  txHash: string;
  timestamp: number;
}

/* ── Component ─────────────────────────────────────────────────── */

export function StakingPage() {
  const [info, setInfo] = useState<StakingInfo | null>(null);
  const [validators, setValidators] = useState<string[]>([]);
  const [staker, setStaker] = useState<StakerView | null>(null);
  const [myStake, setMyStake] = useState<StakerView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Dialog state
  const [stakeOpen, setStakeOpen] = useState(false);
  const [stakeAmount, setStakeAmount] = useState('');
  const [stakeNodeType, setStakeNodeType] = useState('0');
  const [stakeLoading, setStakeLoading] = useState(false);
  const [claimLoading, setClaimLoading] = useState(false);
  const [unstakeLoading, setUnstakeLoading] = useState(false);

  const fetchData = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    try {
      const [infoRes, validatorsRes] = await Promise.all([
        api.get<StakingInfo>('/staking'),
        api.get<ValidatorsResponse>('/staking/validators').catch(() => ({ validators: [], count: 0 })),
      ]);
      setInfo(infoRes);
      setValidators(validatorsRes?.validators ?? []);

      // Try to fetch node signer's own stake via the token distribution endpoint
      try {
        const dist = await api.get<{ signer?: { address?: string } }>('/token/distribution');
        if (dist?.signer?.address) {
          const myData = await api.get<StakerView>(`/staking/${dist.signer.address}`);
          setMyStake(myData);
        }
      } catch {
        // signer may not be staking
      }

      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load staking data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const lookupStaker = async (address: string) => {
    try {
      const data = await api.get<StakerView>(`/staking/${address}`);
      setStaker(data);
    } catch {
      // ignore
    }
  };

  const handleStake = async () => {
    const amount = parseInt(stakeAmount, 10);
    if (!amount || amount <= 0) return;
    setStakeLoading(true);
    setSuccess('');
    try {
      const result = await api.post<TxResult>('/staking/stake', { amount, nodeType: parseInt(stakeNodeType, 10) || 0 });
      setSuccess(`Staked ${amount} Token (tx: ${result?.txHash?.slice(0, 10)}…)`);
      setStakeOpen(false);
      setStakeAmount('');
      fetchData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stake failed');
    } finally {
      setStakeLoading(false);
    }
  };

  const handleRequestUnstake = async () => {
    setUnstakeLoading(true);
    setSuccess('');
    try {
      const result = await api.post<TxResult>('/staking/request-unstake', {});
      setSuccess(`Unstake requested (tx: ${result?.txHash?.slice(0, 10)}…)`);
      fetchData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unstake request failed');
    } finally {
      setUnstakeLoading(false);
    }
  };

  const handleUnstake = async () => {
    setUnstakeLoading(true);
    setSuccess('');
    try {
      const result = await api.post<TxResult>('/staking/unstake', {});
      setSuccess(`Unstake completed (tx: ${result?.txHash?.slice(0, 10)}…)`);
      fetchData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unstake failed');
    } finally {
      setUnstakeLoading(false);
    }
  };

  const handleClaimRewards = async () => {
    setClaimLoading(true);
    setSuccess('');
    try {
      const result = await api.post<TxResult>('/staking/claim-rewards', {});
      setSuccess(`Rewards claimed (tx: ${result?.txHash?.slice(0, 10)}…)`);
      fetchData(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Claim failed');
    } finally {
      setClaimLoading(false);
    }
  };

  const formatCooldown = (seconds: number) => {
    if (!seconds) return '—';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const truncateAddr = (addr: string) => {
    if (!addr || addr.length < 12) return addr ?? '—';
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Staking</h1>
          <p className="text-muted-foreground">Node staking overview and validators</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={stakeOpen} onOpenChange={setStakeOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-1 h-4 w-4" /> Stake</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Stake Tokens</DialogTitle>
                <DialogDescription>
                  Stake tokens to participate in network validation. Min stake: {info?.minStake ?? '—'} Token.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <Field>
                  <FieldLabel htmlFor="stakeAmount">Amount (Token)</FieldLabel>
                  <Input id="stakeAmount" type="number" min="1" placeholder="Enter amount" value={stakeAmount} onChange={(e) => setStakeAmount(e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="nodeType">Node Type</FieldLabel>
                  <Input id="nodeType" type="number" min="0" placeholder="0" value={stakeNodeType} onChange={(e) => setStakeNodeType(e.target.value)} />
                  <FieldDescription>0 = standard, 1 = relay, 2 = validator</FieldDescription>
                </Field>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setStakeOpen(false)}>Cancel</Button>
                <Button onClick={handleStake} disabled={stakeLoading || !stakeAmount}>
                  {stakeLoading ? 'Staking…' : 'Stake'}
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

      {/* Overview Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Staked</CardTitle>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{info?.totalStaked ?? '0'}</div>
            <p className="text-xs text-muted-foreground">Token</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Active Validators</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{info?.activeValidatorCount ?? 0}</div>
            <p className="text-xs text-muted-foreground">nodes</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Min Stake</CardTitle>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{info?.minStake ?? '—'}</div>
            <p className="text-xs text-muted-foreground">Token required</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Cooldown</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCooldown(info?.unstakeCooldown ?? 0)}</div>
            <p className="text-xs text-muted-foreground">unstake delay</p>
          </CardContent>
        </Card>
      </div>

      {/* Reward Info */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Reward Per Epoch</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{info?.rewardPerEpoch ?? '0'} Token</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Slash Per Violation</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{info?.slashPerViolation ?? '0'} Token</div>
          </CardContent>
        </Card>
      </div>

      {/* Your Stake Card */}
      {myStake && Number(myStake.staked) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Your Stake
              <Badge variant={myStake.isActive ? 'default' : 'secondary'}>
                {myStake.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><span className="text-muted-foreground">Staked:</span> <span className="font-bold">{myStake.staked} Token</span></div>
              <div><span className="text-muted-foreground">Node Type:</span> {myStake.nodeType}</div>
              <div><span className="text-muted-foreground">Pending Rewards:</span> <span className="font-bold">{myStake.pendingRewards} Token</span></div>
              <div><span className="text-muted-foreground">Address:</span> <span className="font-mono text-xs">{truncateAddr(myStake.address)}</span></div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleClaimRewards} disabled={claimLoading || myStake.pendingRewards === '0'}>
                <Gift className="mr-1 h-4 w-4" />
                {claimLoading ? 'Claiming…' : 'Claim Rewards'}
              </Button>
              {myStake.unstakeRequestTime > 0 ? (
                <Button size="sm" variant="outline" onClick={handleUnstake} disabled={unstakeLoading}>
                  <ArrowDown className="mr-1 h-4 w-4" />
                  {unstakeLoading ? 'Unstaking…' : 'Complete Unstake'}
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={handleRequestUnstake} disabled={unstakeLoading}>
                  <ArrowDown className="mr-1 h-4 w-4" />
                  {unstakeLoading ? 'Requesting…' : 'Request Unstake'}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Validators List */}
      <Card>
        <CardHeader>
          <CardTitle>Active Validators</CardTitle>
        </CardHeader>
        <CardContent>
          {validators.length === 0 ? (
            <p className="text-muted-foreground text-sm">No active validators</p>
          ) : (
            <div className="space-y-2">
              {validators.map((v) => (
                <div key={v} className="flex items-center justify-between p-2 rounded-md border">
                  <span className="font-mono text-sm">{truncateAddr(v)}</span>
                  <Button variant="ghost" size="sm" onClick={() => lookupStaker(v)}>Details</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Staker Detail */}
      {staker && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Staker: <span className="font-mono text-sm">{truncateAddr(staker.address)}</span>
              <Badge variant={staker.isActive ? 'default' : 'secondary'}>
                {staker.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-muted-foreground">Staked:</span> {staker.staked} Token</div>
              <div><span className="text-muted-foreground">Node Type:</span> {staker.nodeType}</div>
              <div><span className="text-muted-foreground">Pending Rewards:</span> {staker.pendingRewards} Token</div>
              <div><span className="text-muted-foreground">Unstake Request:</span> {staker.unstakeRequestTime ? new Date(staker.unstakeRequestTime * 1000).toLocaleString() : 'None'}</div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
