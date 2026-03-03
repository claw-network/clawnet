import React, { useState } from 'react';
import {
  IonContent,
  IonPage,
  IonInput,
  IonButton,
  IonText,
  IonSpinner,
  useIonToast,
  useIonRouter,
} from '@ionic/react';
import { useWallet } from '../state/WalletContext';
import { ClawLogo } from '../components/ClawLogo';

const ConnectPage: React.FC = () => {
  const { state, connect } = useWallet();
  const [baseUrl, setBaseUrl] = useState(state.connection.baseUrl);
  const [apiKey, setApiKey] = useState(state.connection.apiKey);
  const [loading, setLoading] = useState(false);
  const [presentToast] = useIonToast();
  const router = useIonRouter();

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!baseUrl.trim()) {
      presentToast({ message: 'Please enter a node URL', duration: 2500, color: 'danger', position: 'top' });
      return;
    }
    setLoading(true);
    try {
      await connect(baseUrl.trim(), apiKey.trim());
      presentToast({ message: 'Connected successfully', duration: 2000, color: 'success', position: 'top' });
      router.push('/tabs/dashboard', 'root', 'replace');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      presentToast({ message: msg, duration: 3000, color: 'danger', position: 'top' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <IonPage>
      <IonContent className="ion-padding" scrollY={true}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100%',
            maxWidth: 420,
            margin: '0 auto',
            padding: '2rem 0',
          }}
        >
          <div className="connect-logo" style={{ textAlign: 'center', marginBottom: 32 }}>
            <ClawLogo size={64} />
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: '12px 0 4px' }}>ClawNet Wallet</h1>
            <IonText color="medium">
              <p style={{ fontSize: '0.9rem', margin: 0 }}>Connect to your ClawNet node to manage Tokens</p>
            </IonText>
          </div>

          <form onSubmit={handleConnect} style={{ width: '100%' }}>
            <IonInput
              label="Node URL"
              labelPlacement="stacked"
              type="url"
              placeholder="http://127.0.0.1:9528"
              value={baseUrl}
              onIonInput={(e) => setBaseUrl(e.detail.value ?? '')}
              fill="outline"
              className="mono"
              style={{ marginBottom: 16 }}
              helperText="The HTTP REST API endpoint of your ClawNet node (port 9528)"
              required
            />

            <IonInput
              label="API Key (optional)"
              labelPlacement="stacked"
              type="password"
              placeholder="Enter API key for remote access"
              value={apiKey}
              onIonInput={(e) => setApiKey(e.detail.value ?? '')}
              fill="outline"
              className="mono"
              style={{ marginBottom: 24 }}
            />

            <IonButton expand="block" type="submit" disabled={loading}>
              {loading ? <IonSpinner name="crescent" /> : 'Connect'}
            </IonButton>
          </form>

          <IonText color="medium" style={{ marginTop: 24, textAlign: 'center' }}>
            <p style={{ fontSize: '0.82rem' }}>
              Don't have a node?{' '}
              <a
                href="https://docs.clawnetd.com/getting-started/deployment"
                target="_blank"
                rel="noopener"
                style={{ color: 'var(--ion-color-primary)' }}
              >
                Get started →
              </a>
            </p>
          </IonText>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default ConnectPage;
