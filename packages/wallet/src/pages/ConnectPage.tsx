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
        <div className="connect-container">
          <div className="connect-logo" style={{ textAlign: 'center' }}>
            <ClawLogo size={56} />
            <h1>ClawNet Wallet</h1>
            <IonText color="medium">
              <p style={{ fontSize: '0.85rem', margin: 0, lineHeight: 1.5 }}>
                Connect to your ClawNet node to manage Tokens
              </p>
            </IonText>
          </div>

          <form onSubmit={handleConnect}>
            <IonInput
              label="Node URL"
              labelPlacement="stacked"
              type="url"
              placeholder="https://api.clawnetd.com"
              value={baseUrl}
              onIonInput={(e) => setBaseUrl(e.detail.value ?? '')}
              fill="outline"
              className="mono"
              style={{ marginBottom: 16 }}
              helperText="The HTTP REST API endpoint of your ClawNet node"
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
              style={{ marginBottom: 28 }}
            />

            <IonButton expand="block" type="submit" disabled={loading} style={{ '--border-radius': '14px' }}>
              {loading ? <IonSpinner name="crescent" /> : 'Connect'}
            </IonButton>
          </form>

          <IonText color="medium" style={{ marginTop: 28, textAlign: 'center' }}>
            <p style={{ fontSize: '0.78rem' }}>
              Don't have a node?{' '}
              <a
                href="https://docs.clawnetd.com/getting-started/deployment"
                target="_blank"
                rel="noopener"
                style={{ color: 'var(--ion-color-secondary)' }}
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
