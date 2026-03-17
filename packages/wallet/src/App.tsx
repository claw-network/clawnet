import React from 'react';
import { IonApp, IonRouterOutlet, IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, IonSpinner, IonText, IonButton, setupIonicReact } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { Route, Redirect } from 'react-router-dom';
import { walletOutline, sendOutline, timeOutline, lockClosedOutline } from 'ionicons/icons';

/* Ionic core + theme CSS */
import '@ionic/react/css/core.css';
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

/* Custom theme overrides */
import './theme/variables.css';
import './theme/global.css';

/* Pages */
import ConnectPage from './pages/ConnectPage';
import DashboardPage from './pages/DashboardPage';
import TransferPage from './pages/TransferPage';
import HistoryPage from './pages/HistoryPage';
import EscrowPage from './pages/EscrowPage';

/* Context */
import { WalletProvider, useWallet } from './state/WalletContext';

setupIonicReact({ mode: 'ios' });

const MainTabs: React.FC = () => {
  return (
    <IonTabs>
      <IonRouterOutlet>
        <Route exact path="/tabs/dashboard" component={DashboardPage} />
        <Route exact path="/tabs/transfer" component={TransferPage} />
        <Route exact path="/tabs/history" component={HistoryPage} />
        <Route exact path="/tabs/escrow" component={EscrowPage} />
        <Route exact path="/tabs">
          <Redirect to="/tabs/dashboard" />
        </Route>
      </IonRouterOutlet>

      <IonTabBar slot="bottom" color="dark">
        <IonTabButton tab="dashboard" href="/tabs/dashboard">
          <IonIcon icon={walletOutline} />
          <IonLabel>Dashboard</IonLabel>
        </IonTabButton>
        <IonTabButton tab="transfer" href="/tabs/transfer">
          <IonIcon icon={sendOutline} />
          <IonLabel>Transfer</IonLabel>
        </IonTabButton>
        <IonTabButton tab="history" href="/tabs/history">
          <IonIcon icon={timeOutline} />
          <IonLabel>History</IonLabel>
        </IonTabButton>
        <IonTabButton tab="escrow" href="/tabs/escrow">
          <IonIcon icon={lockClosedOutline} />
          <IonLabel>Escrow</IonLabel>
        </IonTabButton>
      </IonTabBar>
    </IonTabs>
  );
};

const AppRoutes: React.FC = () => {
  const { state, skipReconnect } = useWallet();

  return (
    <>
      {/* Reconnecting overlay — fixed position so IonRouterOutlet is never swapped */}
      {state.reconnecting && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            background: 'var(--ion-background-color, #081020)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <IonSpinner name="crescent" style={{ width: 32, height: 32, marginBottom: 16 }} />
          <IonText color="medium"><p style={{ fontSize: '0.9rem', margin: 0 }}>Reconnecting…</p></IonText>
          <IonButton fill="clear" size="small" color="medium" onClick={skipReconnect} style={{ marginTop: 16 }}>
            Skip
          </IonButton>
        </div>
      )}

      <IonRouterOutlet>
        <Route exact path="/connect" component={ConnectPage} />
        <Route path="/tabs" component={MainTabs} />
        <Route exact path="/">
          {state.connection.connected ? <Redirect to="/tabs/dashboard" /> : <Redirect to="/connect" />}
        </Route>
      </IonRouterOutlet>
    </>
  );
};

const App: React.FC = () => {
  return (
    <IonApp>
      <WalletProvider>
        <IonReactRouter>
          <AppRoutes />
        </IonReactRouter>
      </WalletProvider>
    </IonApp>
  );
};

export default App;
