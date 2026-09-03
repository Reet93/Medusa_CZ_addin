import { describe, it, expect } from "vitest"
import AbraFlexiModuleService from "../service"
import { AbraFlexiClient } from "../../../core/abra-flexi-client"

const options = {
  baseUrl: "https://demo.flexibee.eu:5434",
  company: "demo_company",
  username: "winstrom",
  password: "winstrom",
  vatPayer: false,
}

describe("AbraFlexiModuleService", () => {
  it("stores and returns the options it was constructed with", () => {
    const service = new AbraFlexiModuleService({} as never, options)
    expect(service.getOptions()).toEqual(options)
  })

  it("hands out a configured AbraFlexiClient", () => {
    const service = new AbraFlexiModuleService({} as never, options)
    expect(service.getClient()).toBeInstanceOf(AbraFlexiClient)
  })
})
