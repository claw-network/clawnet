import type { Contact, CreateContactInput, UpdateContactInput, AgentDID } from '@claw-network/client/protocol';
import type { ApiClient } from '../client.js';

export class ContactsModule {
  constructor(private client: ApiClient) {}

  async list(): Promise<Contact[]> {
    const envelope = await this.client.requestData<Contact[]>('GET', '/api/v1/contacts');
    return envelope.data;
  }

  async add(input: CreateContactInput): Promise<Contact> {
    const envelope = await this.client.requestData<Contact>('POST', '/api/v1/contacts', input);
    return envelope.data;
  }

  async update(did: AgentDID, input: UpdateContactInput): Promise<Contact> {
    const envelope = await this.client.requestData<Contact>(
      'PUT',
      `/api/v1/contacts/${encodeURIComponent(did)}`,
      input,
    );
    return envelope.data;
  }

  async remove(did: AgentDID): Promise<void> {
    await this.client.requestNoContent('DELETE', `/api/v1/contacts/${encodeURIComponent(did)}`);
  }
}
