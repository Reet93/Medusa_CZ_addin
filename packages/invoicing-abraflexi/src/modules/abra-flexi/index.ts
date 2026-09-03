import { Module } from "@medusajs/framework/utils"
import AbraFlexiModuleService from "./service.js"

export const ABRA_FLEXI_MODULE = "abraFlexi"

export default Module(ABRA_FLEXI_MODULE, {
  service: AbraFlexiModuleService,
})
