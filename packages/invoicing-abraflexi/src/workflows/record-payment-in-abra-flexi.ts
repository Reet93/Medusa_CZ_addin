import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  when,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
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

export async function recordPaymentStepFn(
  input: { externalCode: string },
  { container }: StepCtx
): Promise<StepResponse<AbraFlexiRecordPaymentResult>> {
  const abraFlexi = container.resolve<AbraFlexiModuleService>(ABRA_FLEXI_MODULE)
  try {
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

    const recordedIds = when({ alreadyRecorded }, ({ alreadyRecorded }) => !alreadyRecorded).then(
      () => {
        const externalCodeInput = transform({ resolved }, ({ resolved }) => ({
          externalCode: abraFlexiExternalCodeForOrder(resolved.order.id),
        }))
        const recordResult = recordPaymentStep(externalCodeInput)
        return persistRecordedPaymentIdStep(
          transform({ resolved, input, recordResult }, ({ resolved, input, recordResult }) => ({
            order: resolved.order,
            paymentId: input.paymentId,
            // Included only to give this step a data dependency on recordResult, so
            // it runs after the API call succeeds, not in parallel with it -- mirrors
            // create-invoice-in-abra-flexi.ts's persistInvoiceIdStep taking the
            // created invoice as input for the same reason.
            recordedPaymentAbraFlexiId: recordResult.id,
          }))
        )
      }
    )

    const result = transform({ resolved, recordedIds }, ({ resolved, recordedIds }) => ({
      recordedPaymentIds:
        recordedIds ??
        ((resolved.order.metadata?.abra_flexi_recorded_payment_ids as string[] | undefined) ?? []),
    }))

    return new WorkflowResponse(result)
  }
)
