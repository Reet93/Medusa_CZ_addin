# @medusa-cz/fulfillment-packeta

Packeta / Zásilkovna pickup-point fulfillment for MedusaJS 2.0. **Status: skeleton (M0).**

## Register (medusa-config.ts)

```ts
{
  resolve: "@medusajs/medusa/fulfillment",
  options: {
    providers: [
      { resolve: "@medusa-cz/fulfillment-packeta", id: "packeta", options: {} },
    ],
  },
}
```
