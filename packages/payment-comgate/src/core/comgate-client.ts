import { COMGATE_BASE_URL } from "../types"
import type { ComgateCreateInput, ComgateCreateResult, ComgateOptions } from "../types"

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

  private async post<T extends { code: number; message: string }>(
    path: string,
    body: object
  ): Promise<T> {
    let res: Response
    try {
      res = await this.fetchFn(`${this.base}${path}`, {
        method: "POST",
        headers: { Authorization: this.auth, "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, test: this.test }),
      })
    } catch (e) {
      throw new ComgateError(1500, `Comgate network error: ${(e as Error).message}`, true)
    }
    if (!res.ok) {
      throw new ComgateError(res.status, `Comgate HTTP ${res.status}`, res.status >= 500)
    }
    const json = (await res.json()) as T
    if (json.code !== 0) {
      throw new ComgateError(json.code, json.message || `Comgate code ${json.code}`)
    }
    return json
  }

  async create(input: ComgateCreateInput): Promise<ComgateCreateResult> {
    return this.post<ComgateCreateResult>("/payment.json", input)
  }
}
