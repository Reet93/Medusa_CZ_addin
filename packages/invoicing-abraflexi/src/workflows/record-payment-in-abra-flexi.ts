import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  when,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MathBN, Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework"
import type { OrderDTO } from "@medusajs/framework/types"
import { ABRA_FLEXI_MODULE } from "../modules/abra-flexi/index.js"
import type AbraFlexiModuleService from "../modules/abra-flexi/service.js"
import { AbraFlexiApiError } from "../core/abra-flexi-client.js"
import { abraFlexiExternalCodeForOrder } from "../core/order-to-invoice-mapper.js"
import { resolveOrderStepFn } from "./create-invoice-in-abra-flexi.js"
import type { AbraFlexiRecordPaymentResult } from "../types.js"

export interface RecordPaymentInAbraFlexiInput {
  paymentId: string
}

interface StepCtx {
  container: MedusaContainer
}

interface ResolvedOrder {
  order: OrderDTO
}

// Reuses create-invoice-in-abra-flexi.ts's resolveOrderStepFn (payment id -> order
// via the payment_collection_id link) rather than duplicating that query -- wrapped
// in its own createStep here (a distinct step name/instance per workflow, matching
// how this repo already keeps each workflow's steps self-contained) rather than
// importing a shared step object across two separate workflow definitions.
const resolveOrderStep = createStep(
  "resolve-order-from-payment-for-payment-record",
  resolveOrderStepFn
)

// Defense-in-depth guard, added after review: the subscriber always runs
// createInvoiceInAbraFlexiWorkflow before this workflow, so in the normal path
// the invoice already exists by the time this runs. But AbraFlexiClient.recordPayment
// PUTs to faktura-vydana.json with an `id: "code:<externalCode>"` -- an upsert-shaped
// write -- so if this workflow were ever invoked directly (or the invoice-creation
// step's persisted id were somehow missing) without a real invoice behind that code,
// Abra Flexi plausibly creates a bare stub invoice carrying only the paid status,
// rather than 404ing. Failing loudly here, before the API call, avoids depending on
// that unverified upsert behavior.
export async function assertInvoiceExistsStepFn(
  { order }: ResolvedOrder,
  _ctx: StepCtx
): Promise<StepResponse<{ invoiceId: string }>> {
  const invoiceId = order.metadata?.abra_flexi_invoice_id as string | undefined
  if (!invoiceId) {
    return StepResponse.permanentFailure(
      `Abra Flexi: cannot record payment for order "${order.id}" -- no abra_flexi_invoice_id in metadata (invoice not created yet)`
    )
  }
  return new StepResponse({ invoiceId })
}
const assertInvoiceExistsStep = createStep(
  "assert-abra-flexi-invoice-exists-before-recording-payment",
  assertInvoiceExistsStepFn
)

type CoverageMoney = { id: string; amount: unknown }
type CoveragePayment = {
  currency_code: string
  canceled_at?: unknown
  captures?: CoverageMoney[]
  refunds?: CoverageMoney[]
}
type CoverageOrder = {
  total: unknown
  currency_code: string
  payment_collections?: Array<{ payments?: CoveragePayment[] }>
}

function validAmount(value: unknown) {
  if (value == null || typeof value === "boolean" || value === "") {
    throw new AbraFlexiApiError(0, "Abra Flexi: missing or invalid payment coverage amount", false)
  }
  const amount = MathBN.convert(value as never)
  if (!amount.isFinite() || amount.isNegative()) {
    throw new AbraFlexiApiError(0, "Abra Flexi: invalid payment coverage amount", false)
  }
  return amount
}

// A capture event is not evidence that the whole invoice has been paid. Read
// fresh captures across the order's collections (including later captures on
// the same payment), not authorized payment.amount or captured_at. Keep partial
// captures unrecorded so a subsequent capture can complete this workflow.
async function isFullyCaptured(orderId: string, container: MedusaContainer): Promise<boolean> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "total",
      "currency_code",
      "payment_collections.payments.currency_code",
      "payment_collections.payments.canceled_at",
      "payment_collections.payments.captures.id",
      "payment_collections.payments.captures.amount",
      "payment_collections.payments.refunds.id",
      "payment_collections.payments.refunds.amount",
    ],
    filters: { id: orderId },
  })
  const order = data[0] as CoverageOrder | undefined
  if (!order || !/^[a-z]{3}$/i.test(order.currency_code ?? "")) {
    throw new AbraFlexiApiError(0, "Abra Flexi: payment coverage order or currency missing", false)
  }
  const total = validAmount(order.total)
  let captured = MathBN.convert(0)
  const capturesSeen = new Set<string>()
  const refundsSeen = new Set<string>()
  for (const collection of order.payment_collections ?? []) {
    for (const payment of collection.payments ?? []) {
      if (payment.canceled_at) continue
      if ((payment.captures?.length ?? 0) === 0) continue
      if (payment.currency_code?.toUpperCase() !== order.currency_code.toUpperCase()) {
        throw new AbraFlexiApiError(0, "Abra Flexi: payment coverage currency mismatch", false)
      }
      let paymentCaptured = MathBN.convert(0)
      for (const capture of payment.captures ?? []) {
        if (!capture.id) {
          throw new AbraFlexiApiError(0, "Abra Flexi: capture identity missing", false)
        }
        if (capturesSeen.has(capture.id)) continue
        capturesSeen.add(capture.id)
        paymentCaptured = paymentCaptured.plus(validAmount(capture.amount))
      }
      let refunded = MathBN.convert(0)
      for (const refund of payment.refunds ?? []) {
        if (!refund.id) {
          throw new AbraFlexiApiError(0, "Abra Flexi: refund identity missing", false)
        }
        if (refundsSeen.has(refund.id)) continue
        refundsSeen.add(refund.id)
        refunded = refunded.plus(validAmount(refund.amount))
      }
      captured = captured.plus(MathBN.max(0, paymentCaptured.minus(refunded)))
    }
  }
  return total.isGreaterThan(0) && captured.isGreaterThanOrEqualTo(total)
}

export async function recordPaymentStepFn(
  input: { externalCode: string; orderId: string },
  { container }: StepCtx
): Promise<StepResponse<AbraFlexiRecordPaymentResult | undefined>> {
  const abraFlexi = container.resolve<AbraFlexiModuleService>(ABRA_FLEXI_MODULE)
  try {
    if (!(await isFullyCaptured(input.orderId, container))) {
      return new StepResponse(undefined)
    }
    const result = await abraFlexi
      .getClient()
      .recordPayment({ invoiceExternalCode: input.externalCode })
    return new StepResponse(result)
  } catch (e) {
    if (e instanceof AbraFlexiApiError && !e.retryable) {
      return StepResponse.permanentFailure(e.message)
    }
    throw e
  }
}
const recordPaymentStep = createStep(
  { name: "record-payment-in-abra-flexi", maxRetries: 3, retryInterval: 30 },
  recordPaymentStepFn
)

export async function persistRecordedPaymentIdStepFn(
  input: { order: OrderDTO; paymentId: string; recordedPaymentAbraFlexiId: string },
  { container }: StepCtx
): Promise<StepResponse<string[]>> {
  const orderModuleService = container.resolve(Modules.ORDER)
  const existing = Array.isArray(input.order.metadata?.abra_flexi_recorded_payment_ids)
    ? (input.order.metadata!.abra_flexi_recorded_payment_ids as string[])
    : []
  const updated = [...existing, input.paymentId]
  await orderModuleService.updateOrders(input.order.id, {
    metadata: {
      ...(input.order.metadata ?? {}),
      abra_flexi_recorded_payment_ids: updated,
    },
  })
  return new StepResponse(updated)
}
const persistRecordedPaymentIdStep = createStep(
  "persist-abra-flexi-recorded-payment-id",
  persistRecordedPaymentIdStepFn
)

export const recordPaymentInAbraFlexiWorkflow = createWorkflow(
  "record-payment-in-abra-flexi",
  (input: RecordPaymentInAbraFlexiInput) => {
    const resolved = resolveOrderStep(input)

    const alreadyRecorded = transform({ resolved, input }, ({ resolved, input }) => {
      const ids = resolved.order.metadata?.abra_flexi_recorded_payment_ids
      return Array.isArray(ids) && ids.includes(input.paymentId)
    })

    const recordResult = when({ alreadyRecorded }, ({ alreadyRecorded }) => !alreadyRecorded).then(
      () => {
        const assertResult = assertInvoiceExistsStep(resolved)
        const externalCodeInput = transform(
          { resolved, assertResult },
          ({ resolved, assertResult }) => ({
            externalCode: abraFlexiExternalCodeForOrder(resolved.order.id),
            orderId: resolved.order.id,
            // Included only to give this step a data dependency on assertResult, so
            // it runs after the invoice-exists guard passes, not in parallel with it --
            // same technique persistRecordedPaymentIdStep below uses for recordResult.
            _invoiceExistsGuard: assertResult.invoiceId,
          })
        )
        return recordPaymentStep(externalCodeInput)
      }
    )

    // Keep conditions at the workflow's top level: Medusa 2.17's composer does
    // not support nesting a when().then() inside another condition.
    const recordedIds = when({ recordResult }, ({ recordResult }) => !!recordResult).then(() =>
      persistRecordedPaymentIdStep(
        transform({ resolved, input, recordResult }, ({ resolved, input, recordResult }) => ({
          order: resolved.order,
          paymentId: input.paymentId,
          // Partial captures must stay eligible for a later capture of this id.
          recordedPaymentAbraFlexiId: recordResult!.id,
        }))
      )
    )

    const result = transform({ resolved, recordedIds }, ({ resolved, recordedIds }) => {
      if (recordedIds) {
        return { recordedPaymentIds: recordedIds }
      }
      const existing = resolved.order.metadata?.abra_flexi_recorded_payment_ids
      return { recordedPaymentIds: Array.isArray(existing) ? (existing as string[]) : [] }
    })

    return new WorkflowResponse(result)
  }
)
