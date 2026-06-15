import { Module } from "@medusajs/framework/utils"
import FakturoidModuleService from "./service"

export const FAKTUROID_MODULE = "fakturoid"

export default Module(FAKTUROID_MODULE, {
  service: FakturoidModuleService,
})
