import { useConnectionStore } from "@/stores/connection"

export function useSdk() {
  return useConnectionStore((state) => state.sdk)
}
