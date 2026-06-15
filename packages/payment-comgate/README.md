# @medusa-cz/payment-comgate

Comgate payment provider for MedusaJS 2.0. **Status: skeleton (M0)** — no payment logic yet.

## Install (once published)

```bash
npm install @medusa-cz/payment-comgate
```

## Register (medusa-config.ts)

```ts
{
  resolve: "@medusajs/medusa/payment",
  options: {
    providers: [
      { resolve: "@medusa-cz/payment-comgate", id: "comgate", options: {} },
    ],
  },
}
```
