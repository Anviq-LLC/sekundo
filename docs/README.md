# Documentation

This repository is a fork of an open source product. The pages in this folder come from two places, and
they are kept apart on purpose.

- **`docs/anviq/`** is what we built and maintain. Start there to learn what this fork adds, how it
  behaves and how to run it.
- **Everything else in `docs/`** is inherited from upstream and is kept as it arrives, so syncing
  upstream never conflicts with our work. Where an upstream page and ours disagree, ours wins.

## Where to start

| You are | Read |
| --- | --- |
| Using the product | [What this fork adds](./anviq/README.md), then [getting started](./getting-started.md) |
| Running an instance | [New customer instance](./new-customer-instance.md) and the [operations guide](./self-host.md) |
| Maintaining the code | [Syncing upstream](./anviq/upstream-sync.md) and the [feature index](./anviq/README.md#features) |

## Rules for these pages

- A feature that exists only in this fork has a page under `docs/anviq/` and an entry in
  `scripts/checks/owned-features.test.mjs`. `pnpm checks` fails when either is missing.
- Never edit an upstream page to describe our behavior. Write it under `docs/anviq/` and link to the
  upstream page it extends.
- The repository is public: no hostnames, customer names, keys or business numbers in any page.
