import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  when,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework"
import type { OrderDTO, RefundDTO } from "@medusajs/framework/types"
import { ABRA_FLEXI_MODULE } from "../modules/abra-flexi/index.js"
import type AbraFlexiModuleService from "../modules/abra-flexi/service.js"
import { AbraFlexiApiError } from "../core/abra-flexi-client.js"
import {
  mapOrderToFullCreditNote,
  mapRefundToLumpSumCreditNote,
} from "../core/order-to-credit-note-mapper.js"

export type CreditNoteTrigger = "order_canceled" | "payment_refunded"

export interface CreateCreditNoteInAbraFlexiInput {
  orderId: string
  triggeredBy: CreditNoteTrigger
}

interface StepCtx {
  container: MedusaContainer
}

export interface ResolvedOrderForCreditNote {
  order: OrderDTO
  paymentIds: string[]
}

// Resolves directly by order id (both trigger paths arrive here already
// holding one -- payment-refunded.ts resolves its payment id to an order id
// first via create-invoice-in-abra-flexi.ts's resolveOrderStepFn,
// order-canceled.ts's event payload already is one). Queries the "order"
// entity itself for "payment_collections.payments.id" -- verified against
// this repo's installed @medusajs/types@2.17.0 (OrderDetailDTO.payment_collections:
// PaymentCollectionDTO[] in dist/order/common.d.ts, PaymentCollectionDTO.payments?:
// PaymentDTO[] in dist/payment/common.d.ts) as a real, queryable field path --
// the direct-direction counterpart to resolveOrderStepFn's existing reverse
// "order_payment_collection" join.
export async function resolveOrderByIdStepFn(
  input: CreateCreditNoteInAbraFlexiInput,
  { container }: StepCtx
): Promise<StepResponse<ResolvedOrderForCreditNote>> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "email",
      "currency_code",
      "metadata",
      "items.title",
      "items.quantity",
      "items.unit_price",
      "shipping_methods.name",
      "shipping_methods.amount",
      "shipping_address.*",
      "billing_address.*",
      "payment_collections.payments.id",
    ],
    filters: { id: input.orderId },
  })

  const order = data[0] as
    | (OrderDTO & { payment_collections?: { payments?: { id: string }[] | null }[] | null })
    | undefined
  if (!order) {
    throw new Error(`Abra Flexi: no order found for order id "${input.orderId}"`)
  }

  const paymentIds = (order.payment_collections ?? [])
    .flatMap((pc) => pc?.payments ?? [])
    .map((p) => p.id)

  return new StepResponse({ order, paymentIds })
}
const resolveOrderByIdStep = createStep(
  "resolve-order-by-id-for-credit-note",
  resolveOrderByIdStepFn
)

export async function listNewRefundsStepFn(
  input: { paymentIds: string[]; recordedRefundIds: string[] },
  { container }: StepCtx
): Promise<StepResponse<RefundDTO[]>> {
  if (input.paymentIds.length === 0) {
    return new StepResponse([])
  }
  const paymentModuleService = container.resolve(Modules.PAYMENT)
  const refunds = await paymentModuleService.listRefunds(
    { payment_id: input.paymentIds },
    // Default page size is 15 (@medusajs/types' listRefunds doc comment) --
    // generous explicit `take` so an order with many refunds over its
    // lifetime doesn't silently truncate which ones this step sees.
    { take: 1000 }
  )
  const sorted = [...refunds].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )
  return new StepResponse(sorted.filter((r) => !input.recordedRefundIds.includes(r.id)))
}
const listNewRefundsStep = createStep("list-new-refunds-for-credit-note", listNewRefundsStepFn)

export interface CreatedCreditNote {
  refundId: string
  creditNoteId: string
  creditNoteCode: string
}

// Loops internally over every new refund rather than one workflow step per
// refund -- Medusa's workflows-sdk has no construct for a step count
// determined by runtime array length (see this plan's Global Constraints),
// so this is the closest instrumentable equivalent to the spec's "per new
// refund: build payload, create" framing while preserving every named
// guarantee -- one independent credit note per refund, processed
// oldest-first (already sorted by listNewRefundsStepFn), each addressed by
// its own deterministic creditNoteExternalCodeForRefund code.
export async function createCreditNotesForNewRefundsStepFn(
  input: {
    order: OrderDTO
    newRefunds: RefundDTO[]
    triggeredBy: CreditNoteTrigger
    invoiceExternalCode: string
  },
  { container }: StepCtx
): Promise<StepResponse<CreatedCreditNote[]>> {
  if (input.newRefunds.length === 0) {
    return new StepResponse([])
  }
  const abraFlexi = container.resolve<AbraFlexiModuleService>(ABRA_FLEXI_MODULE)
  const config = { vatPayer: !!abraFlexi.getOptions().vatPayer }
  const client = abraFlexi.getClient()
  const created: CreatedCreditNote[] = []

  try {
    for (const refund of input.newRefunds) {
      const payload =
        input.triggeredBy === "order_canceled"
          ? mapOrderToFullCreditNote(input.order, config, refund.id)
          : mapRefundToLumpSumCreditNote(input.order, config, {
              id: refund.id,
              amount: Number(refund.amount),
              note: refund.note,
            })
      const result = await client.createCreditNote({
        ...payload,
        originalInvoiceExternalCode: input.invoiceExternalCode,
      })
      created.push({ refundId: refund.id, creditNoteId: result.id, creditNoteCode: result.code })
    }
  } catch (e) {
    if (e instanceof AbraFlexiApiError && !e.retryable) {
      return StepResponse.permanentFailure(e.message)
    }
    throw e
  }

  return new StepResponse(created)
}
const createCreditNotesForNewRefundsStep = createStep(
  { name: "create-credit-notes-for-new-refunds", maxRetries: 3, retryInterval: 30 },
  createCreditNotesForNewRefundsStepFn
)

export async function persistRecordedRefundIdsStepFn(
  input: { order: OrderDTO; newRefundIds: string[] },
  { container }: StepCtx
): Promise<StepResponse<string[]>> {
  const existing = Array.isArray(input.order.metadata?.abra_flexi_recorded_refund_ids)
    ? (input.order.metadata!.abra_flexi_recorded_refund_ids as string[])
    : []
  if (input.newRefundIds.length === 0) {
    return new StepResponse(existing)
  }
  const orderModuleService = container.resolve(Modules.ORDER)
  const updated = [...existing, ...input.newRefundIds]
  await orderModuleService.updateOrders(input.order.id, {
    metadata: { ...(input.order.metadata ?? {}), abra_flexi_recorded_refund_ids: updated },
  })
  return new StepResponse(updated)
}
const persistRecordedRefundIdsStep = createStep(
  "persist-abra-flexi-recorded-refund-ids",
  persistRecordedRefundIdsStepFn
)

export const createCreditNoteInAbraFlexiWorkflow = createWorkflow(
  "create-credit-note-in-abra-flexi",
  (input: CreateCreditNoteInAbraFlexiInput) => {
    const resolved = resolveOrderByIdStep(input)

    const hasInvoice = transform(
      { resolved },
      ({ resolved }) => !!resolved.order.metadata?.abra_flexi_invoice_id
    )

    const recordedRefundIds = when({ hasInvoice }, ({ hasInvoice }) => hasInvoice).then(() => {
      const listInput = transform({ resolved }, ({ resolved }) => ({
        paymentIds: resolved.paymentIds,
        recordedRefundIds: Array.isArray(resolved.order.metadata?.abra_flexi_recorded_refund_ids)
          ? (resolved.order.metadata!.abra_flexi_recorded_refund_ids as string[])
          : [],
      }))
      const newRefunds = listNewRefundsStep(listInput)

      const createInput = transform(
        { resolved, newRefunds, input },
        ({ resolved, newRefunds, input }) => ({
          order: resolved.order,
          newRefunds,
          triggeredBy: input.triggeredBy,
          invoiceExternalCode: resolved.order.metadata?.abra_flexi_invoice_code as string,
        })
      )
      const created = createCreditNotesForNewRefundsStep(createInput)

      const persistInput = transform({ resolved, created }, ({ resolved, created }) => ({
        order: resolved.order,
        newRefundIds: created.map((c) => c.refundId),
      }))
      return persistRecordedRefundIdsStep(persistInput)
    })

    const result = transform(
      { resolved, recordedRefundIds },
      ({ resolved, recordedRefundIds }) => ({
        recordedRefundIds:
          recordedRefundIds ??
          (Array.isArray(resolved.order.metadata?.abra_flexi_recorded_refund_ids)
            ? (resolved.order.metadata!.abra_flexi_recorded_refund_ids as string[])
            : []),
      })
    )

    return new WorkflowResponse(result)
  }
)
