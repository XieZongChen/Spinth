# Contributing to Spinth

Thanks for taking the time to contribute. This document covers the workflow, the
non-negotiable rules of the repository, and what a good change looks like.

## Prerequisites

- Node.js >= 24
- pnpm 11.28.5 (pinned via `packageManager`)
- `pnpm install` also installs the git hooks: pre-commit runs the staged-file hygiene
  check, pre-push runs the full `pnpm verify`. Do not bypass them with `--no-verify`.

## Workflow

```bash
pnpm install
pnpm dev            # http://localhost:5173
pnpm verify         # the gate: hygiene, lint, format, typecheck, licenses, unit tests, build
pnpm test:e2e       # Playwright suites; required when you touch interaction code
```

Keep changes small and reviewable. Every commit should build and pass the gate on its
own, so a bad change can be reverted without untangling unrelated work.

## Commits and sign-off

Commit subjects follow `<type>: <Chinese description>` with one of
`feat | fix | docs | refactor | test | chore`. Review notes in this repository are
written in Chinese, so the description stays in Chinese as well.

Every commit must carry a Developer Certificate of Origin sign-off:

```bash
git commit -s -m "feat: 描述改动"
```

By signing off you certify that you wrote the code or have the right to submit it under
the project's MIT license. No separate CLA is required.

## The rules that reviews will enforce

1. **Docs are the spec.** Read the matching file under [`docs/`](./docs/README.md) before
   implementing. If behavior changes, change the doc in the same pull request.
   `docs/` describes current facts only: no changelogs, dates, PR numbers or
   "previously / now" narratives — git history carries that.
2. **Types first.** New capabilities start as an interface plus a zod schema under
   `packages/core/src/types/`.
3. **Writes go through Yjs.** Never mutate the view model or PIXI objects directly.
   Drag and resize may preview visually, but the commit must go through the model layer.
4. **Explicit dependencies.** Constructor injection and the service registry; no
   decorator DI and no global singletons.
5. **One file, one responsibility.** Non-test sources stay under ~400 lines; split into
   `XxxService` / `XxxVm` / `XxxModel` instead of growing a file.
6. **Tests are part of the change.** Pure logic is covered by vitest, orchestration by
   stub-based tests, end-to-end chains by Playwright. Interaction changes also run
   `pnpm test:e2e` and, for visual changes, the Linux visual baselines.
7. **Package boundaries.** `packages/core` is framework-agnostic, `packages/react` is the
   glue layer, `packages/app` is the shell. The boundary is enforced by ESLint.
8. **Local-first.** The startup path must not require a server, an account or remote
   sync. A board has to stay editable offline and survive a reload.

## Design proposals

Larger changes get a short implementation note in `specs/<feature>.md` (kebab-case, no
prefix), committed together with the code. `specs/` is a process document: unlike
`docs/`, it may record decisions, tradeoffs, verification evidence and commit hashes.

## Repository hygiene

`pnpm hygiene` blocks absolute home paths, email addresses, secrets and local-only
documents (handoff notes, agent scratch directories) from entering the repository.
Do not paste personal machine paths into issues, tests or docs; use relative paths.

## Good first issues

Look for issues labelled `good first issue`. Documentation fixes, additional unit tests
for pure geometry helpers and small accessibility improvements are always welcome.

## License

Contributions are accepted under the [MIT license](./LICENSE).
