import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  when,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
// MedusaContainer specifically from the framework's MAIN entry (not the "/types"
// subpath) — only the main entry's export chain (index -> container -> types/container)
// pulls in the `declare module "@medusajs/types" { interface ModuleImplementations {...} }`
// augmentation that gives `container.resolve(Modules.PAYMENT)` etc. their real return
// types below. OrderDTO has no such requirement, so it comes from the lighter "/types" subpath.
import type { MedusaContainer } from "@medusajs/framework"
import type { OrderDTO } from "@medusajs/framework/types"
import { ABRA_FLEXI_MODULE } from "../modules/abra-flexi/index.js"
import type AbraFlexiModuleService from "../modules/abra-flexi/service.js"
import { AbraFlexiApiError } from "../core/abra-flexi-client.js"
import { mapOrderToAbraFlexiInvoice } from "../core/order-to-invoice-mapper.js"
import type { AbraFlexiInvoicePayload, AbraFlexiInvoiceResult } from "../types.js"

export interface CreateInvoiceInAbraFlexiInput {
  paymentId: string
}

interface StepCtx {
  container: MedusaContainer
}

interface ResolvedOrder {
  order: OrderDTO
}

export async function resolveOrderStepFn(
  input: CreateInvoiceInAbraFlexiInput,
  { container }: StepCtx
): Promise<StepResponse<ResolvedOrder>> {
  const paymentModuleService = container.resolve(Modules.PAYMENT)
  const payment = await paymentModuleService.retrievePayment(input.paymentId)

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order_payment_collection",
    fields: [
      "order.id",
      "order.email",
      "order.currency_code",
      "order.metadata",
      "order.items.title",
      "order.items.quantity",
      "order.items.unit_price",
      "order.shipping_address.*",
      "order.billing_address.*",
    ],
    filters: { payment_collection_id: payment.payment_collection_id },
  })

  const order = data[0]?.order as OrderDTO | undefined
  if (!order) {
    throw new Error(
      `Abra Flexi: no order found for payment "${input.paymentId}" (payment_collection_id "${payment.payment_collection_id}")`
    )
  }
  return new StepResponse<ResolvedOrder>({ order })
}
const resolveOrderStep = createStep("resolve-order-from-payment", resolveOrderStepFn)

export async function mapOrderToPayloadStepFn(
  { order }: ResolvedOrder,
  { container }: StepCtx
): Promise<StepResponse<AbraFlexiInvoicePayload>> {
  const abraFlexi = container.resolve<AbraFlexiModuleService>(ABRA_FLEXI_MODULE)
  const payload = mapOrderToAbraFlexiInvoice(order, { vatPayer: !!abraFlexi.getOptions().vatPayer })
  return new StepResponse(payload)
}
const mapOrderToPayloadStep = createStep(
  { name: "map-order-to-abra-flexi-payload" },
  mapOrderToPayloadStepFn
)

export async function createInvoiceStepFn(
  payload: AbraFlexiInvoicePayload,
  { container }: StepCtx
): Promise<StepResponse<AbraFlexiInvoiceResult>> {
  const abraFlexi = container.resolve<AbraFlexiModuleService>(ABRA_FLEXI_MODULE)
  try {
    const invoice = await abraFlexi.getClient().createInvoice(payload)
    return new StepResponse(invoice)
  } catch (e) {
    if (e instanceof AbraFlexiApiError && !e.retryable) {
      return StepResponse.permanentFailure(e.message)
    }
    throw e
  }
}
const createInvoiceStep = createStep(
  { name: "create-invoice-in-abra-flexi", maxRetries: 3, retryInterval: 30 },
  createInvoiceStepFn
)

export async function persistInvoiceIdStepFn(
  input: { order: OrderDTO; invoice: AbraFlexiInvoiceResult },
  { container }: StepCtx
): Promise<StepResponse<AbraFlexiInvoiceResult>> {
  const orderModuleService = container.resolve(Modules.ORDER)
  await orderModuleService.updateOrders(input.order.id, {
    metadata: {
      ...(input.order.metadata ?? {}),
      abra_flexi_invoice_id: input.invoice.id,
      abra_flexi_invoice_code: input.invoice.code,
    },
  })
  return new StepResponse(input.invoice)
}
const persistInvoiceIdStep = createStep("persist-abra-flexi-invoice-id", persistInvoiceIdStepFn)

export const createInvoiceInAbraFlexiWorkflow = createWorkflow(
  "create-invoice-in-abra-flexi",
  (input: CreateInvoiceInAbraFlexiInput) => {
    const resolved = resolveOrderStep(input)

    const existingInvoiceId = transform(
      { resolved },
      ({ resolved }) => resolved.order.metadata?.abra_flexi_invoice_id as string | undefined
    )

    const newInvoice = when({ existingInvoiceId }, ({ existingInvoiceId }) => !existingInvoiceId).then(
      () => {
        const payload = mapOrderToPayloadStep(resolved)
        const created = createInvoiceStep(payload)
        return persistInvoiceIdStep({ order: resolved.order, invoice: created })
      }
    )

    const result = transform({ resolved, existingInvoiceId, newInvoice }, ({ resolved, existingInvoiceId, newInvoice }) =>
      newInvoice ?? {
        id: existingInvoiceId as string,
        code: resolved.order.metadata?.abra_flexi_invoice_code as string,
      }
    )

    return new WorkflowResponse(result)
  }
)
