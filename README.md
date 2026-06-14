# medusa-cz — the Czech commerce stack for MedusaJS 2.0

Open-source (MIT) integration plugins that make [MedusaJS 2.0](https://medusajs.com)
production-ready for the Czech market: payments, fulfillment, and invoicing.

> **Status:** early development (M0 scaffold). Tested against Medusa **2.15.5**.

## Packages

| Package                          | What it does                                                                | Status       |
| -------------------------------- | --------------------------------------------------------------------------- | ------------ |
| `@medusa-cz/shared`              | Shared CZ value types + utilities (IČO/DIČ validation, error normalization) | scaffold     |
| `@medusa-cz/payment-comgate`     | Comgate payment provider                                                    | planned (M1) |
| `@medusa-cz/fulfillment-packeta` | Packeta / Zásilkovna pickup-point fulfillment                               | planned (M2) |
| `@medusa-cz/payment-gopay`       | GoPay payment provider                                                      | planned (M3) |
| `@medusa-cz/invoicing-fakturoid` | Fakturoid invoicing (order → invoice)                                       | planned (M4) |

## Why

There is no Czech plugin ecosystem for Medusa 2.0 yet. These plugins are free.
We build, host, and support complete Medusa eshops for Czech businesses —
[get in touch](#).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). All commits require a DCO sign-off (`git commit -s`).

## License

MIT © Jakub Sosnovec
