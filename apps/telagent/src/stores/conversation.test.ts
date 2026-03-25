import { beforeEach, describe, expect, it } from "vitest"

import { useConversationStore } from "@/stores/conversation"

describe("useConversationStore", () => {
  beforeEach(() => {
    useConversationStore.setState({
      conversations: [],
      selectedConversationId: null,
      searchQuery: "",
    })
  })

  it("sorts conversations by lastMessageAtMs desc", () => {
    useConversationStore.getState().setConversations([
      {
        conversationId: "direct:b",
        conversationType: "direct",
        displayName: "B",
        unreadCount: 0,
        private: false,
        lastMessageAtMs: 10,
      },
      {
        conversationId: "direct:a",
        conversationType: "direct",
        displayName: "A",
        unreadCount: 0,
        private: false,
        lastMessageAtMs: 20,
      },
    ])

    const ids = useConversationStore.getState().conversations.map((item) => item.conversationId)
    expect(ids).toEqual(["direct:a", "direct:b"])
  })

  it("marks selected conversation as read", () => {
    useConversationStore.setState({
      conversations: [
        {
          conversationId: "direct:a",
          conversationType: "direct",
          displayName: "A",
          unreadCount: 3,
          private: false,
        },
      ],
    })

    useConversationStore.getState().markRead("direct:a")
    expect(useConversationStore.getState().conversations[0].unreadCount).toBe(0)
  })
})
