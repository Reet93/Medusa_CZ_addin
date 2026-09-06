---
"@medusa-cz/invoicing-abraflexi": minor
---

First release. Abra Flexi invoicing module for Medusa v2: issues an invoice
in Abra Flexi on `payment.captured`, with a guard against double-invoicing an
order on a retried or redelivered event (covered by a DB-backed integration
test against a real order/payment). TDD-built.
