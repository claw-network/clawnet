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
import { AuthGuard } from '@/components/auth-guard';

export function App() {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/console/login" element={<LoginPage />} />
            <Route
              path="/console"
              element={
                <AuthGuard>
                  <AppLayout />
                </AuthGuard>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="api-keys" element={<ApiKeysPage />} />
              <Route path="config" element={<ConfigPage />} />
              <Route path="relay" element={<RelayPage />} />
              <Route path="faucet" element={<FaucetPage />} />
              <Route path="storage" element={<StoragePage />} />
            </Route>
            <Route path="*" element={<Navigate to="/console" replace />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  );
}
