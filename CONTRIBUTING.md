# Contributing to Open Board

Thanks for your interest. Open Board was built by a governance professional to solve
real board-secretariat problems, and contributions from people who work in board
administration, legal, compliance, or corporate-secretarial roles are especially welcome —
domain feedback is as valuable as code.

## Ways to contribute

- **Report a bug** — open an issue with what you expected, what happened, and steps to reproduce.
- **Request a feature** — describe the governance workflow you need; the more specific, the better.
- **Improve the docs** — corrections and clearer self-hosting instructions are always welcome.
- **Submit code** — see below.

## Development setup

Requirements: Node 20.12+ (24 recommended), pnpm 11, PostgreSQL 16 (a `docker-compose.yml` for Postgres is included).

```bash
pnpm install
cp .env.example .env      # set SESSION_SECRET
docker compose up -d db
pnpm db:push
pnpm dev
```

See [Run it for development](README.md#run-it-for-development) in the README for the full walkthrough.

## Before you open a pull request

The CI pipeline runs on every PR and must pass. Run the same checks locally:

```bash
pnpm typecheck            # the whole monorepo must type-check
pnpm test                 # unit tests (Vitest); integration tests run when DATABASE_URL is set
pnpm build                # both the API and the frontend must build
```

If you change API routes, keep the OpenAPI spec (`lib/api-spec/openapi.yaml`) and the generated
client in sync (`pnpm --filter @workspace/api-spec run codegen`) — CI checks for drift, including
the orval-maintained barrels, so never hand-edit anything under `lib/*/src/generated` or the
`lib/api-zod/src/index.ts` export list. The spec has **full route coverage** (enforced by
`openapiCoverage.test.ts`): a new Express route must ship with its `openapi.yaml` entry.

## Pull request guidelines

1. Fork the repo and create a feature branch (`git checkout -b feature/committee-cascades`).
2. Keep changes focused; a PR should solve one problem.
3. Describe **what problem it solves**, not just what it changes.
4. Add or update tests for behavior changes — especially anything touching votes, minutes,
   audit, or access control (governance correctness is the point of this project).
5. Don't commit secrets, `.env` files, or uploaded documents.

## Security issues

Please do **not** open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md) for
the private disclosure process.

## License

By contributing, you agree that your contributions are licensed under the MIT License.
