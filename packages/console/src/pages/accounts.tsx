import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
  Users,
  Copy,
  Check,
  Wallet,
  Fingerprint,
  ShieldCheck,
  RefreshCw,
  Landmark,
  FileCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

/* ── Types ─────────────────────────────────────────────────────── */

interface SignerAccount {
  address: string;
  balance: string;
  roles: {
    minter: boolean;
    burner: boolean;
    admin: boolean;
  };
}

interface IdentityAccount {
  did: string;
  evmAddress: string;
  balance: string;
}

interface ValidatorsInfo {
  addresses: string[];
  count: number;
  type: string;
}

interface TreasuryInfo {
  address: string;
  balance: string;
}

interface AccountsData {
  signer?: SignerAccount;
  identity?: IdentityAccount;
  validators?: ValidatorsInfo;
  treasury?: TreasuryInfo;
  contracts?: Record<string, string>;
}

/* ── Component ─────────────────────────────────────────────────── */

export function AccountsPage() {
  const [data, setData] = useState<AccountsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const fetchData = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    try {
      const result = await api.get<AccountsData>('/accounts');
      setData(result);
    } catch {
      // service might not be available
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const CopyBtn = ({ value, id }: { value: string; id: string }) => (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0"
      onClick={() => copyToClipboard(value, id)}
    >
      {copied === id
        ? <Check className="h-3 w-3 text-green-500" />
        : <Copy className="h-3 w-3 text-muted-foreground" />}
    </Button>
  );

  const truncateAddr = (addr: string) => {
    if (!addr || addr.length < 12) return addr ?? '—';
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Accounts</h1>
          <p className="text-muted-foreground">System accounts, validators, and contract addresses</p>
        </div>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => fetchData(true)} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Node Signer + Identity */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Node Signer */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-4 w-4" /> Node Signer
            </CardTitle>
            <CardDescription>EVM signer used for all on-chain operations (mint/burn/deploy)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data?.signer ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground shrink-0">Address</span>
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-mono">{truncateAddr(data.signer.address)}</span>
                    <CopyBtn value={data.signer.address} id="signer-addr" />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground shrink-0">Balance</span>
                  <span className="text-sm font-bold">{data.signer.balance} Token</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground shrink-0">Roles</span>
                  <div className="flex gap-1 flex-wrap justify-end">
                    {data.signer.roles.admin && <Badge variant="default">ADMIN</Badge>}
                    {data.signer.roles.minter && <Badge variant="secondary">MINTER</Badge>}
                    {data.signer.roles.burner && <Badge variant="secondary">BURNER</Badge>}
                    {!data.signer.roles.admin && !data.signer.roles.minter && !data.signer.roles.burner && (
                      <Badge variant="outline">None</Badge>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Chain not configured</p>
            )}
          </CardContent>
        </Card>

        {/* DID Identity */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Fingerprint className="h-4 w-4" /> Node Identity
            </CardTitle>
            <CardDescription>DID and derived EVM address (pseudo-address, no private key)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data?.identity ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground shrink-0">DID</span>
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-mono">{truncateAddr(data.identity.did)}</span>
                    <CopyBtn value={data.identity.did} id="did" />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground shrink-0">Derived EVM</span>
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-mono">{truncateAddr(data.identity.evmAddress)}</span>
                    <CopyBtn value={data.identity.evmAddress} id="derived-addr" />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground shrink-0">Balance</span>
                  <span className="text-sm font-bold">{data.identity.balance} Token</span>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Identity not available</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Validators + Treasury */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Consensus Validators */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Consensus Validators
            </CardTitle>
            <CardDescription>
              {data?.validators?.type ?? 'Unknown'} consensus — {data?.validators?.count ?? 0} active
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data?.validators && data.validators.addresses.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.validators.addresses.map((addr, i) => (
                    <TableRow key={addr}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-mono text-sm">{truncateAddr(addr)}</TableCell>
                      <TableCell>
                        <CopyBtn value={addr} id={`val-${i}`} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No validators detected</p>
            )}
          </CardContent>
        </Card>

        {/* Treasury */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Landmark className="h-4 w-4" /> Treasury (DAO)
            </CardTitle>
            <CardDescription>DAO-controlled treasury for ecosystem funds</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data?.treasury ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground shrink-0">Address</span>
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-mono">{truncateAddr(data.treasury.address)}</span>
                    <CopyBtn value={data.treasury.address} id="treasury-addr" />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground shrink-0">Balance</span>
                  <span className="text-2xl font-bold">{data.treasury.balance} <span className="text-sm font-normal text-muted-foreground">Token</span></span>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">DAO not configured</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Contract Addresses */}
      {data?.contracts && Object.keys(data.contracts).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileCheck className="h-4 w-4" /> Contract Addresses
            </CardTitle>
            <CardDescription>Deployed UUPS proxy addresses on this network</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contract</TableHead>
                  <TableHead>Proxy Address</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(data.contracts).map(([name, addr]) => (
                  <TableRow key={name}>
                    <TableCell className="font-medium capitalize">{formatContractName(name)}</TableCell>
                    <TableCell className="font-mono text-sm">{truncateAddr(addr)}</TableCell>
                    <TableCell>
                      <CopyBtn value={addr} id={`contract-${name}`} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ── Helpers ───────────────────────────────────────────────────── */

const CONTRACT_DISPLAY_NAMES: Record<string, string> = {
  token: 'ClawToken',
  identity: 'ClawIdentity',
  escrow: 'ClawEscrow',
  staking: 'ClawStaking',
  reputation: 'ClawReputation',
  dao: 'ClawDAO',
  contracts: 'ClawContracts',
  router: 'ClawRouter',
  relayReward: 'ClawRelayReward',
};

function formatContractName(key: string): string {
  return CONTRACT_DISPLAY_NAMES[key] ?? key;
}
