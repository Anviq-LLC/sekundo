# Sekundo

Sekundo runs persistent AI agents ("bots") that keep their own conversations, memory and routines
and work on a computer of their own: a browser, a terminal, files and a graphical desktop. One API
serves a web app, an Electron desktop app and an Expo mobile app.

Each customer runs on its own instance with its own database, keys and domain, operated by Sekundo.
Sekundo is in beta.

Sekundo is a white-label version of [Anviq Agents](https://github.com/Anviq-LLC/anviq-agents) by
Anviq LLC.

## Requirements

- Docker Engine 26 or newer with the Compose plugin
- Node.js 22.22.2 or newer in the 22.x line, Node.js 24.x, or Node.js 26+ (development only)
- pnpm 9 (development only)

Node.js 23.x and 25.x are not supported.

## Run locally

```bash
git clone https://github.com/anviq-llc/sekundo.git
cd sekundo
cp .env.example .env
```

Edit `.env`:

- `POSTGRES_PASSWORD`: a URI-safe value, for example `openssl rand -hex 16`. Put the same value
  in `DATABASE_URL`.
- `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY` (64 hex characters), `SCREEN_PROXY_SECRET` and
  `SANDBOX_SUPERVISOR_TOKEN`: independent long random values.
- `OPENROUTER_API_KEY`, or connect a model provider during onboarding.

```bash
docker compose --env-file .env \
  -f infra/compose/docker-compose.yml \
  -f infra/compose/docker-compose.postgres-host.yml \
  up postgres -d
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm sandbox:build
pnpm dev
```

Open <http://127.0.0.1:5173>, create an account and add a model. The first registered user
becomes the deployment owner.

## Deploy an instance

One customer gets one server and one domain. The step by step runbook is
[docs/new-customer-instance.md](./docs/new-customer-instance.md). In short, the stack is the Compose
files in `infra/compose`:

```bash
docker compose --env-file .env -f infra/compose/docker-compose.yml up --build -d
```

Set the public origin in `.env` before the first start:

```env
BETTER_AUTH_URL=https://app.example.com
WEB_ORIGIN=https://app.example.com
API_URL=https://app.example.com
ANVIQ_HOST=app.example.com
```

Terminate TLS in front of port 5173 with a reverse proxy, and do not expose port 3100 or Postgres.
Control who can register with `SIGNUPS_ENABLED` and `SIGNUP_ALLOWLIST`. Pin the image tags to a fixed
build for every customer.

Backups, upgrades, host hardening and the production Compose file are covered in the operations
guide, [docs/self-host.md](./docs/self-host.md).

## Computer providers

Set `SANDBOX_PROVIDER` to one of:

| Value | Notes |
| --- | --- |
| `docker` | Default. Docker computers on the same server, through the sandbox supervisor. |
| `e2b`, `daytona`, `railway`, `boat`, `createos` | Remote providers. Each needs its own API key. |
| `none` | No bot computers. |

Provider details and isolation notes are in
[docs/self-host-sandbox-providers.md](./docs/self-host-sandbox-providers.md) and
[docs/computer-runtime.md](./docs/computer-runtime.md).

## Content encryption

Messages, bot instructions, prompts, memory and files are encrypted at rest with per-space keys.
What is covered and how keys are managed is in
[docs/content-encryption.md](./docs/content-encryption.md).

## Desktop and mobile

The Electron and Expo apps are clients of the same API. Start the desktop app against a running
stack with:

```bash
pnpm --filter @anviq/desktop dev
```

Choose **Existing instance** and enter the server address. Public servers must use HTTPS. Mobile
build and release steps are in [docs/mobile-release.md](./docs/mobile-release.md).

## Repository layout

```text
apps/       web, api, worker, desktop, mobile
packages/   domain, contracts, persistence, adapters, UI, test tooling
infra/      Compose files, sandbox images, updater
docs/       operations and release guides
scripts/    maintenance scripts, including the upstream sync
```

Checks:

```bash
pnpm lint
pnpm check
pnpm test
```

## Documentation

- [New customer instance](./docs/new-customer-instance.md)
- [Operations guide](./docs/self-host.md)
- [Secrets](./docs/self-host-secrets.md)
- [Teams](./docs/teams.md)
- [Content encryption](./docs/content-encryption.md)
- [Computer runtime and isolation](./docs/computer-runtime.md)
- [Desktop releases](./docs/desktop-release.md)
- [Mobile releases](./docs/mobile-release.md)
- [Syncing upstream](./docs/upstream-sync.md)

## Security

Report vulnerabilities as described in [SECURITY.md](./SECURITY.md), not in public issues.

## License

Sekundo is derived from Anviq Agents, which includes code from
[rakazo](https://github.com/elie222/rakazo), licensed under the Apache License 2.0, see
[LICENSE](./LICENSE). Everything else is owned by Anviq LLC and is proprietary, see
[LICENSE-ANVIQ.md](./LICENSE-ANVIQ.md) and [NOTICE](./NOTICE).
