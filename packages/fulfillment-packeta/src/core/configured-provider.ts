import type { PacketaOptions } from "../types.js"

type ProviderEntry = { resolve?: unknown; options?: unknown }
type ModuleEntry = { options?: { providers?: ProviderEntry[] } }

// The Packeta provider's options as configured in medusa-config. Module providers are registered
// in the fulfillment module's own container, so an API route cannot resolve the provider itself.
export function packetaProviderOptions(configModule: { modules?: unknown }): PacketaOptions | null {
  const modules = configModule.modules
  const entries = (
    Array.isArray(modules) ? modules : Object.values((modules ?? {}) as Record<string, unknown>)
  ) as ModuleEntry[]
  for (const mod of entries) {
    for (const provider of mod?.options?.providers ?? []) {
      if (
        typeof provider.resolve === "string" &&
        provider.resolve.includes("fulfillment-packeta")
      ) {
        return (provider.options ?? {}) as PacketaOptions
      }
    }
  }
  return null
}
