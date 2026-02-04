export interface ClientConfig {
  baseUrl: string;
}

export class ClawTokenClient {
  constructor(readonly config: ClientConfig) {}
}
