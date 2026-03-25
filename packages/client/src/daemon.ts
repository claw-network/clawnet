import { loadConfigFromEnv } from './config.js';
import { killStaleTelagentOnPort } from './clawnet/clawnetd-process.js';
import { createLogger, setGlobalLogger } from './logger.js';
import { TelagentNode } from './app.js';

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  const logger = createLogger({
    level: (process.env.TELAGENT_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
    logDir: config.paths.logs,
  });
  setGlobalLogger(logger);

  // Kill any stale telagent process on the API port before starting
  if (await killStaleTelagentOnPort(config.port)) {
    logger.info(`killed stale process on port ${config.port}`);
  }

  const node = new TelagentNode(config);

  await node.start();
  if (config.tls) {
    logger.info(`telagent node started at https://${config.host}:${config.tls.httpsPort}`);
    logger.info(`http://${config.host}:${config.port} → redirect to HTTPS`);
  } else {
    logger.info(`telagent node started at http://${config.host}:${config.port}`);
  }
  logger.info(`chainId: ${config.chain.chainId}`);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`received ${signal}, shutting down`);
    await node.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
