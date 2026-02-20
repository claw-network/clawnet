# @clawnet/node

> ClawNet node daemon — HTTP API and P2P networking for the AI agent economy.

## Install

```bash
npm install @clawnet/node
```

## Usage

### Start as daemon

```bash
npx clawnetd
# API available at http://127.0.0.1:9528
```

### Options

```
clawnetd [options]

  --data-dir <path>         Override storage root
  --api-host <host>         API host (default: 127.0.0.1)
  --api-port <port>         API port (default: 9528)
  --no-api                  Disable local API server
  --listen <multiaddr>      libp2p listen address (repeatable)
  --bootstrap <multiaddr>   Bootstrap peer (repeatable)
  -h, --help                Show help
```

### Programmatic

```typescript
import { startDaemon } from '@clawnet/node';

await startDaemon(['--api-port', '9528']);
```

## Documentation

- [Deployment Guide](https://github.com/OpenClaw/clawnet/blob/main/docs/DEPLOYMENT.md)
- [API Reference](https://github.com/OpenClaw/clawnet/blob/main/docs/API_REFERENCE.md)

## License

MIT
