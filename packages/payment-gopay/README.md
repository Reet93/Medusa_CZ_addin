# @medusa-cz/payment-gopay

GoPay payment provider for MedusaJS 2.0. **Status: skeleton (M0).**

## Register (medusa-config.ts)

```ts
{
  resolve: "@medusajs/medusa/payment",
  options: {
    providers: [
      { resolve: "@medusa-cz/payment-gopay", id: "gopay", options: {} },
    ],
  },
}
```
