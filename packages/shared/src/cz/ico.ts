/**
 * Validates a Czech IČO (company registration number).
 *
 * Rule: exactly 8 digits. The first 7 digits are weighted 8,7,6,5,4,3,2;
 * the check digit is `(11 - (weightedSum % 11)) % 10` and must equal the 8th digit.
 * Leading zeros are significant (IČO is an identifier string, not a number).
 */
export function isValidIco(input: string): boolean {
  const ico = input.trim()
  if (!/^\d{8}$/.test(ico)) {
    return false
  }

  const digits = ico.split("").map((c) => Number(c))
  let weightedSum = 0
  for (let i = 0; i < 7; i++) {
    weightedSum += digits[i]! * (8 - i)
  }

  const checkDigit = (11 - (weightedSum % 11)) % 10
  return checkDigit === digits[7]
}
