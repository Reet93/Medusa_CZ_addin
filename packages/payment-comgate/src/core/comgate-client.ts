import { COMGATE_BASE_URL } from "../types"
import type {
  ComgateCreateInput,
  ComgateCreateResult,
  ComgateOptions,
  ComgateStatusResult,
} from "../types"

export class ComgateError extends Error {
  readonly name = "ComgateError"
  constructor(
    readonly code: number,
    message: string,
    readonly retryable = false
  ) {
    super(message)
  }
}

export function toMinorUnits(major: number): number {
  return Math.round(major * 100)
}
export function fromMinorUnits(minor: number): number {
  return minor / 100
}

export class ComgateClient {
  private readonly base: string
  private readonly auth: string
  private readonly fetchFn: typeof fetch
  private readonly test: boolean

  constructor(opts: ComgateOptions & { baseUrl?: string; fetchFn?: typeof fetch }) {
    this.base = opts.baseUrl ?? COMGATE_BASE_URL
    this.auth = "Basic " + Buffer.from(`${opts.merchant}:${opts.secret}`).toString("base64")
    this.fetchFn = opts.fetchFn ?? fetch
    this.test = !!opts.test
  }

  private async request<T extends { code: number; message: string }>(
    method: string,
    path: string,
    body?: object
  ): Promise<T> {
    let res: Response
    try {
      res = await this.fetchFn(`${this.base}${path}`, {
        method,
        headers: { Authorization: this.auth, "Content-Type": "application/json" },
        body: body ? JSON.stringify({ ...body, test: this.test }) : undefined,
      })
    } catch (e) {
      throw new ComgateError(1500, `Comgate network error: ${(e as Error).message}`, true)
    }
    const retryable = res.status >= 500
    if (!res.ok) {
      const body = await this.safeJson(res)
      if (body && typeof (body as { code?: unknown }).code === "number") {
        const err = body as { code: number; message?: string }
        throw new ComgateError(err.code, err.message || `Comgate code ${err.code}`, retryable)
      }
      throw new ComgateError(res.status, `Comgate HTTP ${res.status}`, retryable)
    }
    let result: T
    try {
      result = (await res.json()) as T
    } catch (e) {
      throw new ComgateError(1500, `Comgate invalid JSON response: ${(e as Error).message}`, true)
    }
    if (result.code !== 0) {
      throw new ComgateError(result.code, result.message || `Comgate code ${result.code}`)
    }
    return result
  }

  private async safeJson(res: Response): Promise<unknown | undefined> {
    try {
      return await res.json()
    } catch {
      return undefined
    }
  }

  async create(input: ComgateCreateInput): Promise<ComgateCreateResult> {
    return this.request<ComgateCreateResult>("POST", "/payment.json", input)
  }

  async status(transId: string): Promise<ComgateStatusResult> {
    return this.request<ComgateStatusResult>(
      "GET",
      `/payment/transId/${encodeURIComponent(transId)}.json`
    )
  }

  async refund(
    transId: string,
    amount: number,
    curr: string
  ): Promise<{ code: number; message: string }> {
    return this.request<{ code: number; message: string }>("POST", "/refund.json", {
      transId,
      amount,
      curr,
    })
  }

  async capturePreauth(
    transId: string,
    amount?: number
  ): Promise<{ code: number; message: string }> {
    return this.request<{ code: number; message: string }>(
      "PUT",
      `/preauth/transId/${encodeURIComponent(transId)}.json`,
      amount != null ? { amount } : {}
    )
  }

  async cancelPreauth(transId: string): Promise<{ code: number; message: string }> {
    return this.request<{ code: number; message: string }>(
      "DELETE",
      `/preauth/transId/${encodeURIComponent(transId)}.json`
    )
  }
}
