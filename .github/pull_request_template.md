## What problem does this solve?

<!-- Describe the problem, not just the change. Link any related issue. -->

## What changed

<!-- A short summary of the approach. -->

## Checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] `pnpm build` passes
- [ ] If API routes changed, the OpenAPI spec + generated client are in sync (`pnpm --filter @workspace/api-spec run codegen`)
- [ ] Added/updated tests for behavior changes (especially votes, minutes, audit, access control)
- [ ] No secrets, `.env` files, or uploaded documents committed
