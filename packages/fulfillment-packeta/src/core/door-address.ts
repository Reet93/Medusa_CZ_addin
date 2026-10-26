// Czech addresses arrive as one line ("Vinohradská 1234/56"); Packeta wants street and house
// number apart, and the postcode without the space Czech customers usually type ("120 00").

export function splitStreet(line: string): { street: string; houseNumber: string } | null {
  const m = line.trim().match(/^(.*\D)\s+(\d+[a-zA-Z]?(?:\/\d+[a-zA-Z]?)?)$/)
  return m ? { street: m[1]!.trim(), houseNumber: m[2]! } : null
}

export function normalizeZip(zip: unknown): string {
  return String(zip ?? "").replace(/\s+/g, "")
}

export function eveningCarrierFor(
  zip: string,
  carriers: Array<{ carrierId: string; zipPrefixes: string[] }>
): string | null {
  return carriers.find((c) => c.zipPrefixes.some((p) => zip.startsWith(p)))?.carrierId ?? null
}
