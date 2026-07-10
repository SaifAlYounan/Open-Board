# ✦ Open Board

**The open-source, AI-native board management platform.** You upload a document, the AI proposes the
next governance action (a meeting, a vote, tasks), and a human on the board secretariat approves it.
Nothing is ever created without a person signing off. It is self-hosted, so your board's documents stay
on infrastructure you control.

> **Beta.** It runs and it is honest about its rough edges. See [what is still stubbed](#roadmap) and
> [report anything wrong](https://github.com/SaifAlYounan/Open-Board/issues).

This page is a step-by-step guide to **installing** and **setting up** Open Board. For a deeper
deployment guide (cloud, HTTPS, backups) see [DEPLOY.md](DEPLOY.md).

---

## Contents

- [What you need](#what-you-need)
- [Install and run](#install-and-run) — the 4-step default
- [First-time setup](#first-time-setup) — logging in and configuring your board
- [Everyday commands](#everyday-commands)
- [Deploy to production (your domain + HTTPS)](#deploy-to-production)
- [Run it for development](#run-it-for-development)
- [Configuration](#configuration)
- [Security](#security) · [Roadmap](#roadmap) · [Contributing](#contributing) · [License](#license)

---

## What you need

For the standard install, the only thing you need is **Docker**:

- **Docker Desktop** (macOS or Windows) or **Docker Engine** (Linux), which includes Docker Compose.
  Install it from [docker.com](https://www.docker.com/products/docker-desktop/) and make sure it is
  running. On macOS and Windows, launch Docker Desktop and wait until it reports "running".
- **Git**, to download the code.

That is all. You do **not** need Node, pnpm, or a separate database. Docker runs everything for you,
including PostgreSQL. (Node and pnpm are only needed if you want to work on the code, see
[Run it for development](#run-it-for-development).)

An AI provider is **optional**. Every manual feature works without one. Configuring one (an Anthropic
API key, or any local OpenAI-compatible server such as Ollama or vLLM) only turns on the AI document
classification and suggestions. See [Turn on AI](#turn-on-ai-optional).

---

## Install and run

Four steps take you from nothing to a running board portal on your machine.

### 1. Download the code

```bash
git clone https://github.com/SaifAlYounan/Open-Board.git
cd Open-Board
```

### 2. Create your configuration file

Copy the example configuration to a new `.env` file:

```bash
cp .env.example .env
```

There is exactly **one value you must set**: `SESSION_SECRET`. It signs login sessions, and the app
refuses to start without it. Generate a random one:

```bash
openssl rand -hex 32
```

Open `.env` in any text editor and paste the result:

```
SESSION_SECRET=paste-the-long-random-string-here
```

Leave every other value at its default for now.

### 3. Start Open Board

```bash
docker compose up -d --build
```

This builds the application image, starts PostgreSQL and the app, and automatically creates the
database tables on first boot. The first build takes a few minutes. Later starts take seconds.

### 4. Open it and sign in

Go to **http://localhost:3000** in your browser.

On the very first boot, Open Board creates an admin account and prints a **one-time password** to the
log. Read it with:

```bash
docker compose logs app | grep "One-time password"
```

You will see a line like:

```
FIRST BOOT — admin account created. One-time password: xxxxxxxxxxxxxxxx
```

Sign in with:

- **Email:** `admin@openboard.local`
- **Password:** the one-time password from the log

You will be asked to set a new password immediately. That is intended. You are now in.

> **Port already in use?** If something else on your machine uses port 3000 (the app) or 5432 (the
> database), add `APP_PORT=` and/or `DB_PORT=` to your `.env` with free ports (for example
> `APP_PORT=3100`), then run `docker compose up -d` again and open the new port.

---

## First-time setup

Once you are logged in as the admin:

### Set your organization details

You already changed the admin password. You can set the admin email and your organization name in the
Admin area, or set `ADMIN_EMAIL` and `ORG_NAME` in `.env` **before** the first boot.

### Add your board and people

From the Admin panel, create your organization's boards and add members. Each new member gets their own
one-time password and is forced to set their own on first login, the same flow you just went through.
Roles (admin, secretary, member, observer) control who can do what.

### Turn on AI (optional)

To enable the AI features (document classification, search, suggested actions), configure a provider in
`.env` and restart (`docker compose up -d`). Two options:

**Anthropic (default provider):**

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

**Local / OpenAI-compatible** — any server that speaks `/v1/chat/completions` (Ollama, vLLM, LM Studio,
llama.cpp, LiteLLM, …), so board documents never leave your network:

```
AI_PROVIDER=openai-compatible
AI_BASE_URL=http://localhost:11434/v1   # your server's OpenAI-compatible root
AI_MODEL=llama3.1:70b                   # a model your server hosts
AI_LIGHT_MODEL=llama3.1:8b              # used for the low-stakes modes
# AI_API_KEY=...                        # only if your server requires one
```

Structured responses are requested via JSON-schema `response_format` when the server supports it, and
fall back to prompt-guided JSON when it doesn't — either way the reply is validated locally against the
same strict schemas before anything reaches the approval queue. Anthropic-specific prompt caching is
skipped on this path, and if the endpoint reports no token usage the daily budget records a conservative
estimate.

Without a provider, the AI features are simply disabled and everything else keeps working. The models
are configurable (`AI_MODEL`, `AI_LIGHT_MODEL`), and on the Anthropic path you can point at an
Anthropic-compatible gateway with `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`. See
[Configuration](#configuration).

### Where your data lives

Your database and uploaded files are stored in Docker named volumes (`db-data` and `uploads`), so they
survive restarts and rebuilds. They are removed only if you explicitly run `docker compose down -v`.

---

## Everyday commands

Run these from inside the `Open-Board` folder:

| Task | Command |
|---|---|
| Start (or apply config changes) | `docker compose up -d` |
| Rebuild after pulling new code | `docker compose up -d --build` |
| View live logs | `docker compose logs -f app` |
| Stop (keeps your data) | `docker compose down` |
| Stop and **erase all data** | `docker compose down -v` |
| Update to the latest version | `git pull` then `docker compose up -d --build` |

---

## Deploy to production

To run Open Board on a server with a real domain and automatic HTTPS, Open Board includes a Caddy
reverse proxy that obtains and renews a Let's Encrypt certificate for you.

1. Point your domain's DNS at the server, and make sure ports 80 and 443 are open.
2. In `.env`, set:

   ```
   NODE_ENV=production
   DOMAIN=board.yourcompany.com
   ACME_EMAIL=you@yourcompany.com
   ALLOWED_ORIGIN=https://board.yourcompany.com
   ```

3. Start with the production profile:

   ```bash
   docker compose --profile production up -d --build
   ```

Open Board will be live at `https://board.yourcompany.com` with a valid certificate.

**One-click cloud deploy:** the repo ships a [Render](https://render.com) blueprint (`render.yaml`) that
provisions a managed PostgreSQL database and the web service, and generates `SESSION_SECRET` for you.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/SaifAlYounan/Open-Board)

For the full production guide (backups, scaling, bare-metal, the complete environment reference) see
**[DEPLOY.md](DEPLOY.md)**.

---

## Run it for development

This is only needed if you want to change the code. It runs the API and the frontend with hot reload
instead of the production image.

Requirements: **Node 20.12+** (24 recommended), **pnpm 11**, and Docker (for the database).

```bash
git clone https://github.com/SaifAlYounan/Open-Board.git
cd Open-Board
pnpm install
cp .env.example .env        # set SESSION_SECRET (openssl rand -hex 32)
docker compose up -d db     # just PostgreSQL, on localhost:5432
pnpm db:push                # create the schema
pnpm dev                    # API + frontend with hot reload
```

The frontend runs on **http://localhost:5173** and proxies API calls to the server on port 3000. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the full contributor workflow (tests, typecheck, OpenAPI drift).

---

## Configuration

All settings live in `.env`. The full, commented list is in [`.env.example`](.env.example). The ones you
are most likely to touch:

| Variable | Required | Purpose |
|---|---|---|
| `SESSION_SECRET` | **Yes** | Signs login sessions. `openssl rand -hex 32`. The app will not start without it. |
| `DATABASE_URL` | Yes (defaulted) | PostgreSQL connection. Preset to match the bundled database. |
| `APP_PORT` / `DB_PORT` | No | Host ports, if 3000 / 5432 are already taken. |
| `ANTHROPIC_API_KEY` | No | Enables AI features on the default Anthropic provider. Omit to run without AI. |
| `AI_PROVIDER` | No | `anthropic` (default) or `openai-compatible` for local inference (Ollama, vLLM, LM Studio, …). |
| `AI_BASE_URL` | With `openai-compatible` | The OpenAI-compatible root, e.g. `http://localhost:11434/v1`. Requests go to `/chat/completions` under it. |
| `AI_API_KEY` | No | Bearer token for the OpenAI-compatible server, if it requires one. |
| `AI_MODEL` / `AI_LIGHT_MODEL` | No | Which models to use (Claude names by default; your server's model names on `openai-compatible`). |
| `NODE_ENV` | No | Set to `production` for secure cookies and to require `ALLOWED_ORIGIN`. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | No | Outbound email for password resets and account invites. Without `SMTP_HOST`, reset links are logged to the server log instead. |
| `APP_BASE_URL` | With SMTP | Public frontend URL used to build the reset links inside emails. |
| `DOMAIN` / `ACME_EMAIL` | Production | Your domain and email, for automatic HTTPS via Caddy. |
| `ALLOWED_ORIGIN` | Production | Allowed browser origin(s) for the API. |
| `DEMO_MODE` | No | `true` seeds a fictional demo organization. Never use in production. |

---

## Security

Open Board is built for governance data, so security is a first-class concern: sessions are signed,
cookies are secured in production, a tamper-evident audit trail records governance actions, access is
controlled per object and per document, and AI proposals are validated against a strict schema and
always require human approval. If you find a vulnerability, please follow [SECURITY.md](SECURITY.md)
rather than opening a public issue. Do your own security review before using this with real board data.

## Roadmap

Open Board is beta and honest about it. The
[open issues](https://github.com/SaifAlYounan/Open-Board/issues) track what is planned and known, and
[CHANGELOG.md](CHANGELOG.md) records what has shipped (recently: weighted and proxy voting, SMTP
password-reset and invite email, real-time updates, and local / OpenAI-compatible model inference).

## Contributing

Contributions are welcome, especially from people who work in board administration, legal, compliance,
or corporate-secretarial roles. Domain feedback is as valuable as code. Start with
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE).
