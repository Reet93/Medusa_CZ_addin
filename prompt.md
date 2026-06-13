Project: medusa-cz — open-source Czech commerce stack for Medusa 2.0. MIT.
medusa-cz/                          (Turborepo + pnpm workspaces)
├── packages/
│   ├── medusa-payment-comgate/     v1 — payment provider (AbstractPaymentProvider)
│   ├── medusa-payment-gopay/       v1 — payment provider
│   ├── medusa-fulfillment-packeta/ v1 — fulfillment + pickup widget
│   └── medusa-invoicing-fakturoid/ v1 — module + order subscribers
├── apps/
│   └── demo/                       Medusa backend + Next.js starter, all plugins wired
├── packages/ (Stage 2)            balikobot, idoklad
└── (private, separate repo)        premium modules — open-core boundary
Each package: own package.json, README with copy-paste install, .env example, tests, and a pinned tested Medusa version range in the README. CLA + MIT from commit one so you can monetize later.
Public positioning: the repo is the sales page — "the Czech commerce stack for Medusa." Free plugins → inbound for paid setup/hosting/support. POHODA stays off the public roadmap (paid bespoke only).
Starting prompt for Claude Code
Paste this into a fresh Claude Code session in an empty repo:

I'm building an open-source suite of Czech-market integration plugins for 
MedusaJS 2.0, MIT-licensed. I'm a solo dev (strong Next.js/TypeScript/
Supabase/Stripe). This session is for ARCHITECTURE DISCUSSION and project 
scaffolding — do not write integration code yet. Push back on my decisions 
where you disagree.

=== CONTEXT ===
There is currently NO Czech plugin ecosystem for Medusa 2.0. The only prior 
art is an abandoned, Medusa-v1-only Comgate plugin (1 GitHub star). Zero 
plugins exist for Packeta, GoPay, Balíkobot, Fakturoid, iDoklad, POHODA. 
Every one of these vendors HAS mature plugins for WooCommerce/PrestaShop/
Shoptet — just not Medusa. I want to own this niche.

Business model: the plugins are free (MIT) and act as lead-gen / reputation. 
Revenue comes from consulting, building+hosting complete Medusa eshops for 
small Czech firms, paid support/SLA, and later open-core premium admin 
modules (kept in a SEPARATE private repo). So the public plugins must be 
genuinely free and clean, but the project structure must preserve an 
open-core boundary.

=== V1 SCOPE (build order matters) ===
1. medusa-payment-comgate     — payment provider. BUILD FIRST (cleanest 
                                 modern REST API v2.0, JSON, Basic auth, 
                                 official PHP SDK to mirror; no JS SDK so we 
                                 write a thin TS client). Proves the 
                                 architecture before the hard stuff.
2. medusa-fulfillment-packeta  — fulfillment provider + pickup-point widget 
                                 (Packeta widget v6, client-side in checkout). 
                                 HARDEST: Medusa v2's fulfillment 
                                 canCalculate/calculatePrice flow has known 
                                 bugs (canCalculate reportedly not called in 
                                 v2 — see medusajs/medusa Discussion #9495 / 
                                 Issue #9598). Plan for workarounds.
3. medusa-payment-gopay        — payment provider (REST v3, OAuth2, official 
                                 SDKs to mirror).
4. medusa-invoicing-fakturoid  — custom module + order-event subscribers. 
                                 Fakturoid API v3, OAuth2 client-credentials 
                                 for single-tenant. (Chosen over POHODA 
                                 deliberately — see exclusions.)

Reference implementations to study: the official @medusajs/payment-stripe 
plugin, and community v2 payment providers (PayU, Mollie, Paystack) for the 
redirect + webhook pattern.

=== EXPLICITLY OUT OF SCOPE FOR V1 ===
- POHODA/Stormware — desktop software via Windows-bound mServer XML interface, 
  not a cloud API. Deployment/support nightmare. PAID BESPOKE WORK ONLY, never 
  a free self-serve plugin. Don't design for it now.
- Balíkobot, iDoklad — Stage 2.
- Premium modules — separate private repo, not this one.

=== DECISIONS I'VE TENTATIVELY MADE (challenge them) ===
- Monorepo: Turborepo + pnpm workspaces. Each package publishes to npm 
  independently under one scope (e.g. @medusa-cz/payment-comgate).
- An apps/demo with the Medusa backend + official Next.js starter, all plugins 
  wired in — doubles as the sales demo.
- MIT + a CLA from the first commit so contributions don't block future 
  monetization.
- Pin and document a tested Medusa version range per package (Medusa ships 
  breaking changes WITHIN 2.x — e.g. Zod 3→4 in v2.14, MikroORM 5→6 in v2.4, 
  product dimension fields → float in v2.15). Maintenance-per-quarter is 
  expected; structure to minimize blast radius.

=== WHAT I WANT FROM THIS SESSION ===
1. Confirm or argue against the monorepo + per-package-publish structure and 
   the Comgate-first build order.
2. Propose the concrete repo scaffold: workspace layout, shared tooling 
   (TS config, build, lint, test, CI), the package skeleton for a Medusa v2 
   payment provider vs a fulfillment provider vs a module-with-subscribers, 
   and how the demo app consumes local workspace packages during dev.
3. Tell me what you need to verify against current Medusa 2.0 docs before 
   scaffolding (provider base-class signatures change between versions — don't 
   assume from training data; check the docs for the version we pin).
4. Flag anything in my plan that's wrong or will bite me later.

Start by stating what you'd change about my plan, then propose the scaffold. 
Ask me the pinned Medusa version before generating anything version-specific.

One deliberate thing baked into that prompt: it tells Claude Code to verify provider base-class signatures against current docs rather than training data. Medusa's v2 APIs have moved enough that a model working from memory will scaffold against a stale interface — the prompt forces a docs check on the version you actually pin.
Want me to draft the README/positioning copy for the public repo, or the per-package skeleton for one provider type so you walk into that session with something concrete to react to?