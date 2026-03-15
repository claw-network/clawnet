import { type ReactNode, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useNode } from '@/lib/node-context';

interface TotpStatus {
  configured: boolean;
  enabled: boolean;
}

/**
 * On testnet/mainnet, redirects to /totp-setup if 2FA is not configured.
 * On devnet, does nothing (2FA is optional).
 */
export function TotpGuard({ children }: { children: ReactNode }) {
  const { network } = useNode();
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Only enforce on testnet/mainnet
    if (network === 'devnet' || !network) {
      setChecked(true);
      return;
    }

    api
      .get<TotpStatus>('/auth/totp/status')
      .then((data) => {
        setStatus(data);
        setChecked(true);
      })
      .catch(() => {
        // If we can't check, allow through
        setChecked(true);
      });
  }, [network]);

  if (!checked) return null;

  // On testnet/mainnet, force 2FA setup if not configured
  if (status && !status.configured && network !== 'devnet') {
    return <Navigate to="/totp-setup" replace />;
  }

  return <>{children}</>;
}
