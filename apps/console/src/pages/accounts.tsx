import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
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
  Shield,
  UserPlus,
  UserMinus,
  XCircle,
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

interface RoleItem {
  name: string;
  hash: string;
  signerHasRole: boolean;
}

interface ContractRoles {
  contract: string;
  address: string;
  roles: RoleItem[];
}

/* ── Component ─────────────────────────────────────────────────── */

export function AccountsPage() {
  const [data, setData] = useState<AccountsData | null>(null);
  const [roles, setRoles] = useState<ContractRoles[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [selectedAddr, setSelectedAddr] = useState<{ title: string; address: string; subtitle?: string } | null>(null);

  // Role management
  const [roleContract, setRoleContract] = useState('');
  const [roleName, setRoleName] = useState('');
  const [roleAddress, setRoleAddress] = useState('');
  const [roleAction, setRoleAction] = useState<'grant' | 'revoke'>('grant');
  const [roleSubmitting, setRoleSubmitting] = useState(false);
  const [roleResult, setRoleResult] = useState('');

  // Validator management
  const [valAddress, setValAddress] = useState('');
  const [valVote, setValVote] = useState<'add' | 'remove'>('add');
  const [valSubmitting, setValSubmitting] = useState(false);
  const [valResult, setValResult] = useState('');
  const [discardAddress, setDiscardAddress] = useState('');
  const [discarding, setDiscarding] = useState(false);
  const [discardResult, setDiscardResult] = useState('');

  const fetchData = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    try {
      const [accountsRes, rolesRes] = await Promise.all([
        api.get<AccountsData>('/accounts'),
        api.get<{ contracts: ContractRoles[] }>('/accounts/roles').catch(() => null),
      ]);
      setData(accountsRes);
      setRoles(rolesRes?.contracts ?? []);
    } catch {
      // service might not be available
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRoleAction = async () => {
    if (!roleContract || !roleName || !roleAddress) return;
    setRoleSubmitting(true);
    setRoleResult('');
    try {
      const endpoint = roleAction === 'grant' ? '/accounts/roles/grant' : '/accounts/roles/revoke';
      const result = await api.post<{ txHash?: string }>(endpoint, {
        contract: roleContract,
        role: roleName,
        address: roleAddress,
      });
      setRoleResult(`${roleAction === 'grant' ? 'Granted' : 'Revoked'}! TX: ${result?.txHash ?? 'success'}`);
      setRoleAddress('');
      fetchData(true);
    } catch (err) {
      setRoleResult(err instanceof Error ? err.message : `Role ${roleAction} failed`);
    } finally {
      setRoleSubmitting(false);
    }
  };

  const handleValidatorPropose = async () => {
    if (!valAddress) return;
    setValSubmitting(true);
    setValResult('');
    try {
      const result = await api.post<{ result?: boolean }>('/accounts/validators/propose', {
        address: valAddress,
        vote: valVote,
      });
      setValResult(`Validator ${valVote} vote proposed for ${valAddress.slice(0, 10)}…`);
      setValAddress('');
      fetchData(true);
    } catch (err) {
      setValResult(err instanceof Error ? err.message : 'Validator proposal failed');
    } finally {
      setValSubmitting(false);
    }
  };

  const handleValidatorDiscard = async () => {
    if (!discardAddress) return;
    setDiscarding(true);
    setDiscardResult('');
    try {
      await api.post<{ result?: boolean }>('/accounts/validators/discard', {
        address: discardAddress,
      });
      setDiscardResult(`Discarded pending vote for ${discardAddress.slice(0, 10)}…`);
      setDiscardAddress('');
    } catch (err) {
      setDiscardResult(err instanceof Error ? err.message : 'Discard failed');
    } finally {
      setDiscarding(false);
    }
  };

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
                    <TableRow
                      key={addr}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedAddr({ title: `Validator #${i + 1}`, address: addr })}
                    >
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
                  <TableRow
                    key={name}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedAddr({ title: formatContractName(name), address: addr, subtitle: name })}
                  >
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

      <Separator />

      {/* Role Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4" /> Role Management
          </CardTitle>
          <CardDescription>View and manage OpenZeppelin AccessControl roles across contracts</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current roles overview */}
          {roles.length > 0 && (
            <div className="space-y-2">
              {roles.map((c) => (
                <div key={c.contract} className="border rounded-lg p-3">
                  <p className="text-sm font-medium mb-2">{formatContractName(c.contract)}</p>
                  <div className="flex flex-wrap gap-1">
                    {c.roles.map((r) => (
                      <Badge
                        key={`${c.contract}-${r.name}`}
                        variant={r.signerHasRole ? 'default' : 'outline'}
                        className="text-xs"
                      >
                        {r.name}{r.signerHasRole && ' ✓'}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <Separator />

          {/* Grant / Revoke form */}
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <Field>
              <FieldLabel>Action</FieldLabel>
              <Select value={roleAction} onValueChange={(v) => setRoleAction(v as 'grant' | 'revoke')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="grant">Grant</SelectItem>
                    <SelectItem value="revoke">Revoke</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Contract</FieldLabel>
              <Select value={roleContract} onValueChange={setRoleContract}>
                <SelectTrigger>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {roles.map((c) => (
                      <SelectItem key={c.contract} value={c.contract}>{formatContractName(c.contract)}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Role</FieldLabel>
              <Select value={roleName} onValueChange={setRoleName}>
                <SelectTrigger>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {roles
                      .filter((c) => !roleContract || c.contract === roleContract)
                      .flatMap((c) => c.roles.map((r) => (
                        <SelectItem key={`${c.contract}-${r.name}`} value={r.name}>{r.name}</SelectItem>
                      )))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Address</FieldLabel>
              <Input placeholder="0x…" value={roleAddress} onChange={(e) => setRoleAddress(e.target.value)} />
            </Field>
          </div>
          <Button
            onClick={handleRoleAction}
            disabled={roleSubmitting || !roleContract || !roleName || !roleAddress}
            variant={roleAction === 'revoke' ? 'destructive' : 'default'}
          >
            {roleSubmitting ? 'Submitting…' : roleAction === 'grant' ? 'Grant Role' : 'Revoke Role'}
          </Button>
          {roleResult && <p className="text-xs text-muted-foreground">{roleResult}</p>}
        </CardContent>
      </Card>

      {/* Validator Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Validator Management
          </CardTitle>
          <CardDescription>Propose adding or removing consensus validators (QBFT/Clique voting)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Propose vote */}
            <div className="space-y-3 border rounded-lg p-4">
              <p className="text-sm font-medium flex items-center gap-2">
                <UserPlus className="h-4 w-4" /> Propose Validator Vote
              </p>
              <Field>
                <FieldLabel>Validator Address</FieldLabel>
                <Input placeholder="0x…" value={valAddress} onChange={(e) => setValAddress(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel>Vote</FieldLabel>
                <Select value={valVote} onValueChange={(v) => setValVote(v as 'add' | 'remove')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="add">Add Validator</SelectItem>
                      <SelectItem value="remove">Remove Validator</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Button
                onClick={handleValidatorPropose}
                disabled={valSubmitting || !valAddress}
                variant={valVote === 'remove' ? 'destructive' : 'default'}
              >
                {valSubmitting ? 'Proposing…' : 'Submit Vote'}
              </Button>
              {valResult && <p className="text-xs text-muted-foreground">{valResult}</p>}
            </div>

            {/* Discard vote */}
            <div className="space-y-3 border rounded-lg p-4">
              <p className="text-sm font-medium flex items-center gap-2">
                <XCircle className="h-4 w-4" /> Discard Pending Vote
              </p>
              <Field>
                <FieldLabel>Validator Address</FieldLabel>
                <Input placeholder="0x…" value={discardAddress} onChange={(e) => setDiscardAddress(e.target.value)} />
              </Field>
              <Button
                variant="outline"
                onClick={handleValidatorDiscard}
                disabled={discarding || !discardAddress}
              >
                {discarding ? 'Discarding…' : 'Discard Vote'}
              </Button>
              {discardResult && <p className="text-xs text-muted-foreground">{discardResult}</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Address Detail Dialog */}
      <Dialog open={!!selectedAddr} onOpenChange={(open) => { if (!open) setSelectedAddr(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{selectedAddr?.title}</DialogTitle>
          </DialogHeader>
          {selectedAddr && (
            <div className="space-y-3">
              {selectedAddr.subtitle && (
                <p className="text-xs text-muted-foreground">{selectedAddr.subtitle}</p>
              )}
              <div>
                <p className="text-xs text-muted-foreground mb-2">Proxy Address</p>
                <div className="flex items-center gap-2 bg-muted rounded px-3 py-2">
                  <span className="font-mono text-xs break-all flex-1">{selectedAddr.address}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => copyToClipboard(selectedAddr.address, 'dialog-addr')}
                  >
                    {copied === 'dialog-addr'
                      ? <Check className="h-3.5 w-3.5 text-green-500" />
                      : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
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
