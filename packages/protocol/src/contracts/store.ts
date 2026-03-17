import { EventEnvelope } from '@claw-network/core/protocol';
import { applyContractEvent, ContractState, createContractState } from './state.js';
import { ServiceContract } from './types.js';

export interface ContractStore {
  applyEvent(envelope: EventEnvelope): Promise<void>;
  applyEvents(envelopes: EventEnvelope[]): Promise<void>;
  getContract(contractId: string): Promise<ServiceContract | undefined>;
  listContracts(): Promise<ServiceContract[]>;
  getState(): Promise<ContractState>;
}

export class MemoryContractStore implements ContractStore {
  private state: ContractState = createContractState();

  async applyEvent(envelope: EventEnvelope): Promise<void> {
    this.state = applyContractEvent(this.state, envelope);
  }

  async applyEvents(envelopes: EventEnvelope[]): Promise<void> {
    for (const envelope of envelopes) {
      this.state = applyContractEvent(this.state, envelope);
    }
  }

  async getContract(contractId: string): Promise<ServiceContract | undefined> {
    return this.state.contracts[contractId];
  }

  async listContracts(): Promise<ServiceContract[]> {
    return Object.values(this.state.contracts);
  }

  async getState(): Promise<ContractState> {
    return this.state;
  }
}
