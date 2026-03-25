import { beforeEach, describe, expect, it } from "vitest"

import { useConnectionStore } from "@/stores/connection"
import { useMarketStore } from "@/stores/market"

describe("useMarketStore", () => {
  beforeEach(() => {
    useMarketStore.setState({
      listings: [],
      searchResults: [],
      bidsByTask: {},
      disputes: [],
      activeFilter: "all",
      loadingListings: false,
      loadingBids: false,
      loadingDisputes: false,
      error: undefined,
    })
  })

  it("refreshListings normalizes and sorts listing list", async () => {
    useConnectionStore.setState({
      sdk: {
        marketplace: {
          listTasks: async () => [
            { id: "task-1", title: "First", budget: 20 },
            { id: "task-2", title: "Second", budget: 50 },
          ],
          listInfoListings: async () => [],
          listCapabilities: async () => [],
        },
      } as never,
    })

    await useMarketStore.getState().refreshListings()

    const listings = useMarketStore.getState().listings
    expect(listings.map((item: { id: string }) => item.id)).toEqual(["task-2", "task-1"])
  })

  it("getListingById checks listings then search results", () => {
    useMarketStore.setState({
      listings: [
        {
          id: "task-main",
          type: "task",
          title: "Main",
          status: "open",
          raw: {},
        },
      ],
      searchResults: [
        {
          id: "task-search",
          type: "task",
          title: "Search",
          status: "open",
          raw: {},
        },
      ],
    })

    const fromListings = useMarketStore.getState().getListingById("task-main")
    const fromSearch = useMarketStore.getState().getListingById("task-search")

    expect(fromListings?.title).toBe("Main")
    expect(fromSearch?.title).toBe("Search")
  })
})
