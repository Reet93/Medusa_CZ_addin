# @medusa-cz/shared

Shared Czech-market value types and utilities for `medusa-cz` plugins.

## Install

```bash
pnpm add @medusa-cz/shared
```

## Usage

```ts
import { isValidIco } from "@medusa-cz/shared"

isValidIco("25596641") // true — valid IČO check digit
isValidIco("12345678") // false
```

## API

### `isValidIco(input: string): boolean`

Validates a Czech IČO (company registration number): exactly 8 digits, with
the 8th digit a checksum over the first 7 (weights 8,7,6,5,4,3,2, mod 11).
Leading zeros are significant — pass the IČO as a string, not a number.

## Tests

```bash
pnpm --filter @medusa-cz/shared test
```
