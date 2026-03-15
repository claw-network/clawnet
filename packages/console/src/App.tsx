import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider } from '@/components/theme-provider';
import { AppLayout } from '@/components/app-layout';
import { LoginPage } from '@/pages/login';
import { DashboardPage } from '@/pages/dashboard';
import { ApiKeysPage } from '@/pages/api-keys';
import { ConfigPage } from '@/pages/config';
import { RelayPage } from '@/pages/relay';
import { FaucetPage } from '@/pages/faucet';
import { StoragePage } from '@/pages/storage';
import { SecurityPage } from '@/pages/security';
import { TotpSetupPage } from '@/pages/totp-setup';
import { GovernancePage } from '@/pages/governance';
import { StakingPage } from '@/pages/staking';
import { TokenPage } from '@/pages/token';
import { ContractsPage } from '@/pages/contracts';
import { EscrowPage } from '@/pages/escrow';
import { EcosystemPage } from '@/pages/ecosystem';
import { AccountsPage } from '@/pages/accounts';
import { AuthGuard } from '@/components/auth-guard';
import { TotpGuard } from '@/components/totp-guard';

export function App() {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/totp-setup"
              element={
                <AuthGuard>
                  <TotpSetupPage />
                </AuthGuard>
              }
            />
            <Route
              path="/"
              element={
                <AuthGuard>
                  <TotpGuard>
                    <AppLayout />
                  </TotpGuard>
                </AuthGuard>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="api-keys" element={<ApiKeysPage />} />
              <Route path="config" element={<ConfigPage />} />
              <Route path="relay" element={<RelayPage />} />
              <Route path="faucet" element={<FaucetPage />} />
              <Route path="storage" element={<StoragePage />} />
              <Route path="security" element={<SecurityPage />} />
              <Route path="governance" element={<GovernancePage />} />
              <Route path="staking" element={<StakingPage />} />
              <Route path="token" element={<TokenPage />} />
              <Route path="contracts" element={<ContractsPage />} />
              <Route path="escrow" element={<EscrowPage />} />
              <Route path="ecosystem" element={<EcosystemPage />} />
              <Route path="accounts" element={<AccountsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  );
}
