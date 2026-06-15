import { describe, expect, it } from "vitest"
import { isValidIco } from "./ico"

describe("isValidIco", () => {
  it("accepts a valid 8-digit IČO (checksum ok)", () => {
    // 49619331: weighted sum 187, 187 % 11 == 0 -> check digit 1 -> matches
    expect(isValidIco("49619331")).toBe(true)
  })

  it("accepts a valid IČO with leading zeros", () => {
    // 00006947 is a real valid IČO (Czech National Bank); checksum holds with leading zeros
    expect(isValidIco("00006947")).toBe(true)
  })

  it("rejects a number whose check digit is wrong", () => {
    expect(isValidIco("49619332")).toBe(false)
  })

  it("rejects wrong length", () => {
    expect(isValidIco("1234567")).toBe(false)
    expect(isValidIco("123456789")).toBe(false)
  })

  it("rejects non-numeric input", () => {
    expect(isValidIco("4961933X")).toBe(false)
    expect(isValidIco("")).toBe(false)
  })

  it("tolerates surrounding whitespace", () => {
    expect(isValidIco("  49619331 ")).toBe(true)
  })
})
