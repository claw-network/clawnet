export function resolvePeerAvatarUrl(
  avatarUrl: string | undefined,
  peerNodeUrl: string | undefined,
): string | undefined {
  if (!avatarUrl) {
    return undefined;
  }

  if (!avatarUrl.startsWith('/')) {
    return avatarUrl;
  }

  if (!peerNodeUrl) {
    return avatarUrl;
  }

  return `${peerNodeUrl.replace(/\/$/, '')}${avatarUrl}`;
}

/**
 * Returns the local proxy path the frontend should use to load a peer avatar.
 * The local node will proxy the request to the remote peer node, avoiding
 * cross-origin / firewall issues in the browser.
 */
export function localPeerAvatarUrl(did: string, avatarUrl: string | undefined): string | undefined {
  if (!avatarUrl) return undefined;
  return `/api/v1/profile/${encodeURIComponent(did)}/avatar`;
}

/**
 * Returns true when the URL resolves to the local node's own API endpoint.
 * Used by the avatar proxy to skip direct-HTTP attempts that would hit
 * ourselves instead of the remote peer (common when nodes listen on 127.0.0.1
 * behind a reverse proxy without TELAGENT_PUBLIC_URL configured).
 */
export function isSelfOrigin(
  url: string,
  config: { host: string; port: number; tls?: { httpsPort: number } },
): boolean {
  try {
    const remote = new URL(url);
    const localHost = config.host === '0.0.0.0' || config.host === '::' ? '127.0.0.1' : config.host;
    const remoteHost = remote.hostname === 'localhost' ? '127.0.0.1' : remote.hostname;
    if (remoteHost !== localHost) return false;
    const remotePort = remote.port ? Number(remote.port) : (remote.protocol === 'https:' ? 443 : 80);
    return remotePort === config.port || (!!config.tls && remotePort === config.tls.httpsPort);
  } catch {
    return false;
  }
}

/**
 * Derive the effective public URL for this node. When `publicUrl` is explicitly
 * configured it takes precedence; when TLS is enabled we use the HTTPS endpoint;
 * otherwise we fall back to `http://host:port`.
 * This ensures profile cards always carry an absolute URL so peers can proxy
 * avatars without requiring every operator to set TELAGENT_PUBLIC_URL.
 */
export function getEffectiveNodeUrl(config: { host: string; port: number; publicUrl?: string; tls?: { httpsPort: number } }): string {
  if (config.publicUrl) return config.publicUrl.replace(/\/$/, '');
  const host = config.host === '0.0.0.0' || config.host === '::' ? '127.0.0.1' : config.host;
  if (config.tls) {
    return `https://${host}:${config.tls.httpsPort}`;
  }
  return `http://${host}:${config.port}`;
}
