# New customer instance

One customer gets one server and one domain, with its own stack, database and secrets. Nothing is
shared between customers.

## Before you start

- Linux server with Docker Engine 26 or newer, the Compose plugin, curl and OpenSSL. Bot computers
  use memory, so size the server for the number of bots the customer will run.
- A hostname such as `agents.customer.example` pointing at the server, with TCP 80 and 443 open.
- SMTP credentials owned by the customer (Resend, Amazon SES or their own mail server). Never reuse
  another customer's or your own mailbox.

## Install

```bash
mkdir -p /opt/anviq && cd /opt/anviq
curl -fsSLO https://raw.githubusercontent.com/anviq-llc/sekundo/main/infra/compose/install-images.sh
bash install-images.sh --prepare-only
```

That downloads the compose files and writes `.env` with generated secrets without starting anything.
Edit `.env`:

```env
BETTER_AUTH_URL=https://agents.customer.example
WEB_ORIGIN=https://agents.customer.example
API_URL=https://agents.customer.example
ANVIQ_HOST=agents.customer.example
SMTP_URL=smtps://user:password@smtp.customer.example:465
EMAIL_FROM=Sekundo <no-reply@customer.example>
SANDBOX_COMPUTER_EGRESS=restricted
```

Set `ANVIQ_LICENSEE` to the customer's name when this instance is licensed to them. It is shown at
the bottom of Settings, General. Leave it unset on any instance that is not a customer deployment.

## Pin the version

`edge` follows every push to `main`, so a customer server must not use it. Pin both image tags to a
fixed build in `.env`:

```env
ANVIQ_IMAGE_TAG=sha-<full commit>
ANVIQ_COMPUTER_IMAGE_TAG=sha-<full commit>
```

Every push to `main` publishes a `sha-<full commit>` tag. Find the commit with
`git ls-remote https://github.com/anviq-llc/sekundo main`, and check that the build finished in
the repository's Actions tab before using it. A release tag such as `v1.0.0` works the same way
once one has been pushed. Pinning keeps the customer on the version you tested until you change
the tag.

## Start

With HTTPS from the customer's own reverse proxy, or when the server has no proxy yet and you use
the Caddy setup in `docs/self-host.md`:

```bash
bash install-images.sh
```

When the server already runs Traefik with the Docker provider, add the overlay instead:

```bash
curl -fsSLO https://raw.githubusercontent.com/anviq-llc/sekundo/main/infra/compose/docker-compose.traefik.yml
docker compose --env-file .env -f docker-compose.images.yml -f docker-compose.traefik.yml up -d
```

Then apply the host firewall rules for bot computers once:

```bash
curl -fsSLO https://raw.githubusercontent.com/anviq-llc/sekundo/main/infra/compose/restrict-computer-egress.sh
sudo bash restrict-computer-egress.sh
```

## First login

1. The customer's administrator registers at the public URL. The first account becomes the owner.
2. Close registration afterwards by setting `SIGNUPS_ENABLED=false` in `.env`, or set
   `SIGNUP_ALLOWLIST` to the customer's email addresses, then recreate the stack with the same
   `up -d` command.
3. The administrator connects a model on first login. Built-in memory needs no setup. It stores
   notes in the customer's own database.

## Updates and backups

To update, change the two tags in `.env`, then run `docker compose ... pull` and `up -d` with the
same files as above. To roll back, set the previous tags again.

Back up the database and the bot files. The built-in memory lives in the same database:

```bash
docker compose --env-file .env -f docker-compose.images.yml exec -T postgres \
  pg_dump -U anviq anviq | gzip > anviq-$(date +%F).sql.gz
```

The Docker volumes `pgdata` and `appdata` hold the database and the bot files.
