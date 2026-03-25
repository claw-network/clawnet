import process from 'node:process';

import {
  loadRequiredTelagentEnvFile,
  resolveDefaultNodeExtraCaCerts,
} from './start-env.js';

async function main(): Promise<void> {
  try {
    loadRequiredTelagentEnvFile();

    // Keep local mkcert-issued HTTPS working for manual setups that do not
    // persist NODE_EXTRA_CA_CERTS into $TELAGENT_HOME/.env.
    if (!process.env.NODE_EXTRA_CA_CERTS) {
      const caFile = resolveDefaultNodeExtraCaCerts();
      if (caFile) {
        process.env.NODE_EXTRA_CA_CERTS = caFile;
      }
    }

    await import('./daemon.js');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

void main();
