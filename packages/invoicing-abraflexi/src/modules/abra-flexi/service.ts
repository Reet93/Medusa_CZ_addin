import { MedusaService } from "@medusajs/framework/utils"
import { AbraFlexiClient } from "../../core/abra-flexi-client.js"
import type { AbraFlexiOptions } from "../../types.js"

class AbraFlexiModuleService extends MedusaService({}) {
  protected options_: AbraFlexiOptions

  constructor(container: Record<string, unknown>, options: AbraFlexiOptions) {
    super(container, options)
    this.options_ = options
  }

  getOptions(): AbraFlexiOptions {
    return this.options_
  }

  getClient(): AbraFlexiClient {
    return new AbraFlexiClient(this.options_)
  }
}

export default AbraFlexiModuleService
