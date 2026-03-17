import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel } from '@/components/ui/field';
import { Separator } from '@/components/ui/separator';
import { api } from '@/lib/api';
import { Coins, RefreshCw, ArrowUpRight, ArrowDownRight, Wallet, Send } from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────── */

interface TokenSupply {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
}

interface TokenDistribution {
  treasury: { address: string; balance: string };
  staking: { address: string; balance: string };
  signer: { address: string; balance: string };
}

/* ── Component ─────────────────────────────────────────────────── */

export function TokenPage() {
  const [supply, setSupply] = useState<TokenSupply | null>(null);
  const [distribution, setDistribution] = useState<TokenDistribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  // Mint form
  const [mintTo, setMintTo] = useState('');
  const [mintAmount, setMintAmount] = useState('');
  const [mintMemo, setMintMemo] = useState('');
  const [minting, setMinting] = useState(false);
  const [mintResult, setMintResult] = useState('');

  // Transfer form
  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferMemo, setTransferMemo] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [transferResult, setTransferResult] = useState('');

  // Burn form
  const [burnFrom, setBurnFrom] = useState('');
  const [burnAmount, setBurnAmount] = useState('');
  const [burning, setBurning] = useState(false);
  const [burnResult, setBurnResult] = useState('');

  const fetchData = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    try {
      const [supplyRes, distRes] = await Promise.all([
        api.get<TokenSupply>('/token/supply'),
        api.get<TokenDistribution>('/token/distribution').catch(() => null),
      ]);
      setSupply(supplyRes);
      setDistribution(distRes);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load token data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleMint = async () => {
    if (!mintTo || !mintAmount) return;
    setMinting(true);
    setMintResult('');
    try {
      const result = await api.post<{ txHash?: string }>('/token/mint', {
        to: mintTo,
        amount: parseInt(mintAmount, 10),
        memo: mintMemo || undefined,
      });
      setMintResult(`Minted! TX: ${result?.txHash ?? 'success'}`);
      setMintTo('');
      setMintAmount('');
      setMintMemo('');
      fetchData(true);
    } catch (err) {
      setMintResult(err instanceof Error ? err.message : 'Mint failed');
    } finally {
      setMinting(false);
    }
  };

  const handleTransfer = async () => {
    if (!transferTo || !transferAmount) return;
    setTransferring(true);
    setTransferResult('');
    try {
      const result = await api.post<{ txHash?: string }>('/token/transfer', {
        to: transferTo,
        amount: parseInt(transferAmount, 10),
        memo: transferMemo || undefined,
      });
      setTransferResult(`Transferred! TX: ${result?.txHash ?? 'success'}`);
      setTransferTo('');
      setTransferAmount('');
      setTransferMemo('');
      fetchData(true);
    } catch (err) {
      setTransferResult(err instanceof Error ? err.message : 'Transfer failed');
    } finally {
      setTransferring(false);
    }
  };

  const handleBurn = async () => {
    if (!burnFrom || !burnAmount) return;
    setBurning(true);
    setBurnResult('');
    try {
      const result = await api.post<{ txHash?: string }>('/token/burn', {
        from: burnFrom,
        amount: parseInt(burnAmount, 10),
      });
      setBurnResult(`Burned! TX: ${result?.txHash ?? 'success'}`);
      setBurnFrom('');
      setBurnAmount('');
      fetchData(true);
    } catch (err) {
      setBurnResult(err instanceof Error ? err.message : 'Burn failed');
    } finally {
      setBurning(false);
    }
  };

  const truncateAddr = (addr: string) => {
    if (!addr || addr.length < 12) return addr ?? '—';
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Token</h1>
          <p className="text-muted-foreground">
            {supply?.name ?? 'ClawToken'} ({supply?.symbol ?? 'CLAW'}) — {supply?.decimals ?? 0} decimals
          </p>
        </div>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => fetchData(true)} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      {/* Supply */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">Total Supply</CardTitle>
          <Coins className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{supply?.totalSupply ?? '—'} Token</div>
        </CardContent>
      </Card>

      {/* Distribution */}
      {distribution && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Treasury</CardTitle>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{distribution.treasury.balance} Token</div>
              <p className="text-xs text-muted-foreground mt-1 font-mono">{truncateAddr(distribution.treasury.address)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Staking Pool</CardTitle>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{distribution.staking.balance} Token</div>
              <p className="text-xs text-muted-foreground mt-1 font-mono">{truncateAddr(distribution.staking.address)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Node Signer</CardTitle>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{distribution.signer.balance} Token</div>
              <p className="text-xs text-muted-foreground mt-1 font-mono">{truncateAddr(distribution.signer.address)}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Separator />

      {/* Transfer */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Send className="h-4 w-4" /> Transfer Tokens</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <Field><FieldLabel>To Address</FieldLabel><Input placeholder="0x..." value={transferTo} onChange={(e) => setTransferTo(e.target.value)} /></Field>
            <Field><FieldLabel>Amount</FieldLabel><Input type="number" placeholder="100" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} /></Field>
            <Field><FieldLabel>Memo (optional)</FieldLabel><Input placeholder="Payment for service" value={transferMemo} onChange={(e) => setTransferMemo(e.target.value)} /></Field>
          </div>
          <Button onClick={handleTransfer} disabled={transferring || !transferTo || !transferAmount}>{transferring ? 'Transferring…' : 'Transfer'}</Button>
          {transferResult && <p className="text-xs text-muted-foreground">{transferResult}</p>}
        </CardContent>
      </Card>

      <Separator />

      {/* Admin: Mint & Burn */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ArrowUpRight className="h-4 w-4" /> Mint Tokens</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field><FieldLabel>To Address</FieldLabel><Input placeholder="0x..." value={mintTo} onChange={(e) => setMintTo(e.target.value)} /></Field>
            <Field><FieldLabel>Amount</FieldLabel><Input type="number" placeholder="100" value={mintAmount} onChange={(e) => setMintAmount(e.target.value)} /></Field>
            <Field><FieldLabel>Memo (optional)</FieldLabel><Input placeholder="Faucet grant" value={mintMemo} onChange={(e) => setMintMemo(e.target.value)} /></Field>
            <Button onClick={handleMint} disabled={minting || !mintTo || !mintAmount}>{minting ? 'Minting…' : 'Mint'}</Button>
            {mintResult && <p className="text-xs text-muted-foreground">{mintResult}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ArrowDownRight className="h-4 w-4" /> Burn Tokens</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field><FieldLabel>From Address</FieldLabel><Input placeholder="0x..." value={burnFrom} onChange={(e) => setBurnFrom(e.target.value)} /></Field>
            <Field><FieldLabel>Amount</FieldLabel><Input type="number" placeholder="100" value={burnAmount} onChange={(e) => setBurnAmount(e.target.value)} /></Field>
            <Button variant="destructive" onClick={handleBurn} disabled={burning || !burnFrom || !burnAmount}>{burning ? 'Burning…' : 'Burn'}</Button>
            {burnResult && <p className="text-xs text-muted-foreground">{burnResult}</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
