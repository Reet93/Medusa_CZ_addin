import type { ModuleExports } from "@medusajs/framework/types"
import { Module } from "@medusajs/framework/utils"
import AbraFlexiModuleService from "./service.js"

export const ABRA_FLEXI_MODULE = "abraFlexi"

// Annotated: the inferred type names a pnpm-internal @medusajs/types path (TS2742).
const abraFlexiModule: ModuleExports<typeof AbraFlexiModuleService> = Module(ABRA_FLEXI_MODULE, {
  service: AbraFlexiModuleService,
})

export default abraFlexiModule
