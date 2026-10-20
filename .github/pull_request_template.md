## Summary

<!-- What changes and why. Link the issue it closes, if any (Closes #123). -->

## Type

<!-- The Conventional Commit type of this PR (see CONTRIBUTING.md), e.g. feat(web), fix(shared), docs, test, chore(deploy). -->

- [ ] `feat`
- [ ] `fix`
- [ ] `docs`
- [ ] `test`
- [ ] `refactor` / `perf` / `chore`

## Checklist

- [ ] `npm run lint` and `npm run typecheck` pass
- [ ] `npm test` passes (and the integration tests with `TEST_DB_NAME`, `npm run test:e2e` or `pytest` in `apps/ai` where the change touches them)
- [ ] A bug fix comes with a test that proves it
- [ ] Docs updated if behaviour changed (docs/, the app READMEs) and a line added to `CHANGELOG.md` under `[Unreleased]`
- [ ] New migrations are documented in `docs/DATABASE.md` (and any upgrade step in the CHANGELOG upgrade notes)
- [ ] No `.env` files, tokens or database dumps are committed
