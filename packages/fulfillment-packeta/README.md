# @medusa-cz/fulfillment-packeta

Packeta / Zásilkovna pickup-point fulfillment for MedusaJS 2.0.

Customers pick a Packeta pickup point during checkout (Widget v6); the provider
creates the packet on fulfillment, prints labels, tracks shipments, closes
batches, and handles returns. Supports COD and external-carrier points.

## Register (medusa-config.ts)

```ts
{
  resolve: "@medusajs/medusa/fulfillment",
  options: {
    providers: [
      {
        resolve: "@medusa-cz/fulfillment-packeta/providers/packeta",
        id: "packeta",
        options: {
          apiKey: process.env.PACKETA_API_KEY, // public Widget key
          apiPassword: process.env.PACKETA_API_PASSWORD, // secret REST password — server only
          eshop: process.env.PACKETA_ESHOP, // sender label
          defaultCurrency: "CZK",
          validatePointServerSide: true,
          priceTable: {
            cz: {
              bands: [
                { maxWeight: 5, price: 79 },
                { maxWeight: 10, price: 99 },
              ],
              codSurcharge: 30,
              freeOver: 1500,
            },
          },
        },
      },
    ],
  },
}
```

`validateOptions` requires both `apiKey` and `apiPassword`. The container
registers the provider under `fp_packeta_packeta`
(`fp_${identifier}_${id}`); the fulfillment `provider_id` on shipping options is
`packeta_packeta`.

## Selected-point data contract

The storefront writes the chosen point into the cart shipping-method `data`;
`validateFulfillmentData` reads exactly these keys:

- `pickup_point_id`, `pickup_point_name`, `pickup_point_type` (`internal` | `external`)
- `carrier_id`, `carrier_pickup_point_id` (external points only)

## Admin routes

Both resolve the configured provider server-side — the secret `apiPassword` is
never accepted from the request:

- `GET /admin/packeta/tracking/:packetId` → `{ status, tracking }`
- `POST /admin/packeta/close-batch` body `{ packetIds: string[] }` → `{ shipment }`

## Storefront (apps/storefront)

The checkout delivery step renders a pickup-point picker for the Packeta option
and carries the selection into the shipping-method `data`. Only the **public**
`NEXT_PUBLIC_PACKETA_API_KEY` reaches the browser — never `apiPassword`.

- `src/lib/packeta.ts` — Widget v6 loader + typed `pickPacketaPoint()`
- `src/modules/checkout/components/packeta-pickup-point/` — picker component
- `src/modules/checkout/components/shipping/` — renders the picker, gates "Continue"

## Manual acceptance (Widget v6 round-trip)

### Run the stack

```bash
# backend
export PACKETA_API_KEY=… PACKETA_API_PASSWORD=… PACKETA_ESHOP=<test-sender>
cd apps/backend && pnpm dev
# in another shell: seed the CZK region + calculated Packeta option
npx medusa exec ./src/scripts/seed-packeta.ts

# storefront — set NEXT_PUBLIC_PACKETA_API_KEY + a publishable key in .env.local
cd apps/storefront && pnpm dev
```

### ⚠️ Safe testing — there is NO sandbox

Packeta has **no test environment**; you test against the real API with your real
key + password. That is safe **as long as you stay in the create → cancel zone**:

- `createPacket` (fired by **Create fulfillment**) only **registers** a packet —
  nothing ships and **nothing is billed**. It is fully reversible with
  `cancelPacket` (the **Cancel fulfillment** flow).
- The **point of no return is close-batch (`createShipment`)** — it hands the
  batch to Packeta. **Do NOT close-batch test packets**, and never physically
  drop off a test parcel.
- Isolate test packets with a dedicated **test sender** in `PACKETA_ESHOP`, and
  **`cancelPacket` every test packet** when finished.

In short: exercise the full lifecycle **except** close-batch + physical handover.

### Drive the round-trip (browser)

1. Add a product to the CZK-region cart → checkout.
2. Choose the **Packeta pickup point** shipping option → the picker appears.
3. Click **Choose pickup point** → the Widget opens → select a point → it shows
   under the option. The calculated price renders; **Continue** enables.
4. Complete the order.
5. In admin: a fulfillment exists → **Create fulfillment** → packet created
   (check the order fulfillment `data.packet_id`). Print the label (fulfillment
   documents). Refresh tracking. **Stop here for test packets — do _not_ close
   the batch** (see the safety note above).
6. Repeat with a COD order and an external-carrier point.
7. **Clean up: Cancel fulfillment** on every test packet (`cancelPacket`) so no
   test records linger in your account.

> Close-batch (`POST /admin/packeta/close-batch`) is exercised **only** against
> real shipments you actually intend to hand over — never against test packets.

> The widget runs in an isolated iframe and uses the public `apiKey` only.
