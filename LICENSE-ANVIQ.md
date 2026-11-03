# Anviq additions

Copyright 2026 Anviq LLC. All rights reserved.

Sekundo is a white-label version of Anviq Agents, owned by Anviq LLC. This repository combines two
kinds of material.

1. Upstream code from rakazo and its contributors, including upstream files that Anviq LLC only
   renamed or reconfigured. It is licensed under the Apache License, Version 2.0, see
   [LICENSE](./LICENSE).
2. Anviq additions: everything else. That means files created by Anviq LLC, Anviq LLC's own
   changes to upstream files, and everything added or changed for Sekundo. All of it is owned by
   Anviq LLC. No license is granted to use, copy, modify or distribute it. Viewing and forking this
   repository on GitHub is permitted as far as GitHub's terms of service allow. Any other use
   needs the written agreement of Anviq LLC. Access to this repository, or to any part of it,
   does not grant a license.

## Telling them apart

The upstream code is the content of the `anviq-upstream` branch of
[Anviq-LLC/anviq-agents](https://github.com/Anviq-LLC/anviq-agents). It is rebuilt from upstream
with only the Anviq rename applied (see `scripts/upstream/`).

- A file that is not on that branch is an Anviq addition.
- A line that differs from that branch, in a file that is on it, is an Anviq change.
- The git history of this repository starts from a snapshot of the renamed upstream code and does
  not carry the upstream commit authors. Copyright in the upstream code stays with its authors.
- New Anviq source files start with the line `Copyright 2026 Anviq LLC. All rights reserved.`
- Contributions to this repository are accepted only under a written agreement that assigns
  the copyright to Anviq LLC.

## Trademarks

The names Anviq and Anviq Agents and the Anviq logo are trademarks of Anviq LLC and are not
licensed under either license. Neither license grants any right in the name Sekundo.

## Additions that are not source files

- The `@anviq/memory-engine` dependency, which is proprietary Anviq code from
  https://github.com/Anviq-LLC/anviq-memory under its own license. Sekundo uses it under a
  written license agreement with Anviq LLC.
- Anviq logo and icon files:
  `apps/web/public/` (`favicon.*`, `icon-*.png`, `apple-touch-icon.png`),
  `apps/desktop/assets/` (`icon*`),
  `apps/mobile/assets/` (`icon*.png`, `adaptive-icon.png`, `monochrome-icon.png`,
  `splash-icon.png`, `favicon.png`, `notification-icon.png`),
  `apps/mobile/modules/anviq-notifications/android/src/main/res/drawable/ic_anviq_notification.xml`,
  `packages/ui-tokens/assets/Anviq.icon/`
