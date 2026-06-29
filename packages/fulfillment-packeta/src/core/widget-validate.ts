import { PACKETA_WIDGET_VALIDATE_URL } from "../types.js"

export interface ValidatePointArgs {
  apiKey: string
  point: { id?: string; carrierId?: string; carrierPickupPointId?: string }
  options?: Record<string, unknown>
  fetchFn?: typeof fetch
}

export async function validatePoint(
  args: ValidatePointArgs
): Promise<{ isValid: boolean; errors: string[] }> {
  const fetchFn = args.fetchFn ?? fetch
  let res: Response
  try {
    res = await fetchFn(PACKETA_WIDGET_VALIDATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: args.apiKey, point: args.point, options: args.options ?? {} }),
    })
  } catch {
    // Network failure → don't hard-block checkout; treat as invalid with a clear code.
    return { isValid: false, errors: ["ValidationUnavailable"] }
  }
  if (res.status === 401) {
    return { isValid: false, errors: ["InvalidApiKey"] }
  }
  if (!res.ok) {
    return { isValid: false, errors: [`HTTP_${res.status}`] }
  }
  const body = (await res.json()) as {
    isValid?: boolean
    errors?: Array<{ code?: string } | string>
  }
  const errors = (body.errors ?? []).map((e) => (typeof e === "string" ? e : (e.code ?? "Unknown")))
  return { isValid: !!body.isValid, errors }
}
