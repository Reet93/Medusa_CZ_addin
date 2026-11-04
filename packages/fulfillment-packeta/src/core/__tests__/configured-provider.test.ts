import { describe, expect, it } from "vitest"
import { packetaProviderOptions } from "../configured-provider"

// Live 2026-11-04: admin routes resolved "fp_packeta_packeta" from the request scope, but module
// providers live in the fulfillment module's own container ("Could not resolve"). The routes now
// build the provider from its configured options.
describe("packetaProviderOptions", () => {
  const config = (modules: unknown) => ({ modules }) as never

  it("finds the Packeta provider options in a modules array", () => {
    expect(
      packetaProviderOptions(
        config([
          { resolve: "@medusa-cz/invoicing-abraflexi", options: {} },
          {
            resolve: "@medusajs/medusa/fulfillment",
            options: {
              providers: [
                { resolve: "@medusajs/medusa/fulfillment-manual", id: "manual" },
                {
                  resolve: "@medusa-cz/fulfillment-packeta/providers/packeta",
                  id: "packeta",
                  options: { apiPassword: "x", labelFormat: "A6 on A6" },
                },
              ],
            },
          },
        ])
      )
    ).toEqual({ apiPassword: "x", labelFormat: "A6 on A6" })
  })

  it("finds them in a modules map", () => {
    expect(
      packetaProviderOptions(
        config({
          fulfillment: {
            options: {
              providers: [
                {
                  resolve: "./node_modules/@medusa-cz/fulfillment-packeta/providers/packeta",
                  options: { apiPassword: "y" },
                },
              ],
            },
          },
        })
      )
    ).toEqual({ apiPassword: "y" })
  })

  it("is null when the provider is not configured", () => {
    expect(packetaProviderOptions(config([]))).toBeNull()
  })
})
