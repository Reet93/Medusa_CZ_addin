# medusa-cz — the Czech commerce stack for MedusaJS 2.0

Open-source (MIT) integration plugins that make [MedusaJS 2.0](https://medusajs.com)
production-ready for the Czech market: payments, fulfillment, and invoicing.

> **Status:** active development. Comgate + Packeta wired end-to-end in the demo;
> Abra Flexi invoice issuance live; GoPay not yet started. Tested against Medusa **2.17.0**.

## Packages

| Package                          | What it does                                                                | Status                                |
| -------------------------------- | --------------------------------------------------------------------------- | ------------------------------------- |
| `@medusa-cz/shared`              | Shared CZ value types + utilities (IČO/DIČ validation, error normalization) | stable                                |
| `@medusa-cz/payment-comgate`     | Comgate payment provider                                                    | done (M1)                             |
| `@medusa-cz/fulfillment-packeta` | Packeta / Zásilkovna pickup-point fulfillment                               | done (M2)                             |
| `@medusa-cz/payment-gopay`       | GoPay payment provider                                                      | planned (M3) — not started            |
| `@medusa-cz/invoicing-abraflexi` | Abra Flexi invoicing (order → invoice)                                      | in progress (M4, 1 of 4 sub-projects) |

## Why

There is no Czech plugin ecosystem for Medusa 2.0 yet. These plugins are free.
We build, host, and support complete Medusa eshops for Czech businesses —
[get in touch](#).

## Demo

The sales demo (Medusa backend + storefront) that exercises these plugins end-to-end lives in
a private companion repo (`mente-eshop`) — it consumes these packages from a sibling checkout,
not npm, until the first `@medusa-cz/*` release.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). All commits require a DCO sign-off (`git commit -s`).

## License

MIT © Jakub Sosnovec
