# Contributing to medusa-cz

Thanks for helping build the Czech commerce stack for Medusa.

## Developer Certificate of Origin (DCO)

This project uses the [DCO](https://developercertificate.org/) instead of a CLA.
By contributing, you certify the statement below for each commit.

**Every commit must be signed off.** Add the sign-off line automatically with:

```bash
git commit -s -m "your message"
```

This appends a trailer to your commit message:

```
Signed-off-by: Your Name <your.email@example.com>
```

The name/email must match your git `user.name` / `user.email`. CI rejects PRs whose
commits are missing a valid `Signed-off-by` trailer.

### The DCO text you are certifying

> By making a contribution to this project, I certify that:
> (a) the contribution was created in whole or in part by me and I have the right
> to submit it under the open source license indicated in the file; or
> (b) the contribution is based upon previous work covered under an appropriate
> open source license and I have the right under that license to submit that
> work with modifications; or
> (c) the contribution was provided directly to me by some other person who
> certified (a), (b) or (c) and I have not modified it.
> (d) I understand and agree that this project and the contribution are public and
> that a record of the contribution is maintained indefinitely.

## Development

```bash
corepack enable
pnpm install
pnpm build      # turbo: builds all packages
pnpm test       # turbo: runs all tests
pnpm lint
pnpm typecheck
```

## Changesets

If you change a published package, record it:

```bash
pnpm changeset
```

Pick the package(s) and bump type. The release workflow publishes on merge to `main`.
