import type { AgentDID, Envelope, GroupID } from "@claw-network/client/protocol"

export type OwnerMode = "observer" | "intervener"

export type InterventionScope =
  | "send_message"
  | "manage_contacts"
  | "manage_groups"
  | "clawnet_transfer"
  | "clawnet_escrow"
  | "clawnet_market"
  | "clawnet_reputation"

export interface OwnerPermissions {
  mode: OwnerMode
  interventionScopes: InterventionScope[]
  privateConversations: string[]
}

export interface ConversationSummary {
  conversationId: string
  conversationType: "direct" | "group"
  peerDid?: AgentDID
  groupId?: GroupID
  displayName: string
  lastMessagePreview?: string | null
  lastMessageAtMs?: number
  unreadCount: number
  private: boolean
  avatarUrl?: string | null
}

export interface MessageWithStatus extends Envelope {
  deliveryStatus?: "pending" | "failed" | "sent"
  lastError?: string
  clientRawCiphertext?: string
  clientDisplayText?: string
}
