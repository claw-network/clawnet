export class SequenceAllocator {
  private readonly byConversation = new Map<string, bigint>();

  next(conversationId: string): bigint {
    const nextValue = (this.byConversation.get(conversationId) ?? 0n) + 1n;
    this.byConversation.set(conversationId, nextValue);
    return nextValue;
  }

  current(conversationId: string): bigint {
    return this.byConversation.get(conversationId) ?? 0n;
  }
}
