import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api';
import { Database, HardDrive, FolderOpen } from 'lucide-react';

interface StorageInfo {
  dataDir?: string;
  databases?: Array<{
    name: string;
    path?: string;
    size?: number;
    tables?: number;
  }>;
  directories?: Array<{
    name: string;
    path?: string;
    size?: number;
    files?: number;
  }>;
  [key: string]: unknown;
}

export function StoragePage() {
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [nodeInfo, setNodeInfo] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchData() {
      try {
        const info = await api.get<Record<string, unknown>>('/node');
        setNodeInfo(info);
        // Storage info might come from node status or a dedicated endpoint
        const storageData: StorageInfo = {
          dataDir: (info.dataDir as string) || '~/.clawnet',
          databases: [
            { name: 'events.sqlite', path: 'events.sqlite' },
            { name: 'api-keys.sqlite', path: 'api-keys.sqlite' },
            { name: 'indexer.sqlite', path: 'indexer.sqlite' },
          ],
          directories: [
            { name: 'keys/', path: 'keys/' },
            { name: 'level/', path: 'level/' },
            { name: 'logs/', path: 'logs/' },
          ],
        };
        setStorage(storageData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load storage info');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const formatSize = (bytes?: number) => {
    if (bytes === undefined) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Storage</h1>
        <p className="text-muted-foreground">Node data directory and database files</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-5 w-5" />
              Data Directory
            </CardTitle>
            <CardDescription className="font-mono text-xs mt-1">
              {storage?.dataDir ?? '~/.clawnet'}
            </CardDescription>
          </div>
          <Badge variant="secondary">
            {(nodeInfo as Record<string, unknown>)?.network as string ?? 'unknown'}
          </Badge>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Databases
            </CardTitle>
            <CardDescription>SQLite database files</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(storage?.databases ?? []).map((db) => (
                  <TableRow key={db.name}>
                    <TableCell className="font-mono text-xs">{db.name}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {formatSize(db.size)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5" />
              Directories
            </CardTitle>
            <CardDescription>Node data subdirectories</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Files</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(storage?.directories ?? []).map((dir) => (
                  <TableRow key={dir.name}>
                    <TableCell className="font-mono text-xs">{dir.name}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {dir.files ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {nodeInfo && (
        <Card>
          <CardHeader>
            <CardTitle>Node Runtime Info</CardTitle>
            <CardDescription>Full node status from /api/v1/node</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border bg-muted/50 p-4 overflow-auto max-h-64">
              <pre className="text-xs font-mono whitespace-pre-wrap">
                {JSON.stringify(nodeInfo, null, 2)}
              </pre>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
