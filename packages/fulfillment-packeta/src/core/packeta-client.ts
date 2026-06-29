import { XMLBuilder, XMLParser } from "fast-xml-parser"
import { PACKETA_REST_URL } from "../types.js"
import type { PacketAttributes, PacketIdDetail } from "../types.js"

export class PacketaError extends Error {
  readonly name = "PacketaError"
  constructor(
    readonly fault: string,
    message: string,
    readonly retryable = false
  ) {
    super(message)
  }
}

export interface PacketaClientOptions {
  apiPassword: string
  url?: string
  fetchFn?: typeof fetch
}

export class PacketaClient {
  private readonly url: string
  private readonly apiPassword: string
  private readonly fetchFn: typeof fetch
  private readonly builder: XMLBuilder
  private readonly parser: XMLParser

  constructor(opts: PacketaClientOptions) {
    this.url = opts.url ?? PACKETA_REST_URL
    this.apiPassword = opts.apiPassword
    this.fetchFn = opts.fetchFn ?? fetch
    // Keep numeric-looking values as strings so 64-bit ids never become JS numbers.
    this.builder = new XMLBuilder({ suppressEmptyNode: true })
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseTagValue: false,
    })
  }

  /** POST one XML method call; return the parsed `<result>` (or root) on success. */
  protected async call<T = Record<string, unknown>>(
    method: string,
    args: Record<string, unknown>
  ): Promise<T> {
    // apiPassword MUST be the first element (research §B).
    const xml = this.builder.build({ [method]: { apiPassword: this.apiPassword, ...args } })
    let res: Response
    try {
      res = await this.fetchFn(this.url, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8" },
        body: xml,
      })
    } catch (e) {
      throw new PacketaError("NetworkError", `Packeta network error: ${(e as Error).message}`, true)
    }
    if (!res.ok) {
      throw new PacketaError("HttpError", `Packeta HTTP ${res.status}`, res.status >= 500)
    }
    const parsed = this.parser.parse(await res.text()) as Record<string, any>
    const root = parsed.response ?? Object.values(parsed)[0] ?? {}
    const status = root["@_status"] ?? root.status
    if (status === "fault" || root.fault) {
      throw new PacketaError(
        String(root.fault ?? "fault"),
        String(root.string ?? root.detail ?? "Packeta API fault")
      )
    }
    return (root.result ?? root) as T
  }

  async createPacket(attrs: PacketAttributes): Promise<PacketIdDetail> {
    const result = await this.call<{ id: string | number; barcode: string }>("createPacket", {
      packetAttributes: attrs,
    })
    return { id: String(result.id), barcode: String(result.barcode) }
  }
}
