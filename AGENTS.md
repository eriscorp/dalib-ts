# Agent guide

`@eriscorp/dalib-ts` is a TypeScript library. It parses and manipulates Dark Ages (DOOMVAS v1) client files. It is the TypeScript translation of the C# `eriscorp/dalib`. A given defect usually belongs to one of the two libraries, not both. Identify which library the consumer uses before you make a change.

## Where work is tracked

**Do not open GitHub issues.** The maintainers track this library in an internal issue tracker. The GitHub issue tracker stays open for outside reports, but an agent that files there puts the work where the maintainers do not look.

If you find a defect and you have access to the internal tracker, write a card there. Use the `dalib-ts` label. If you do not have access, report the defect to the user in your reply. Let the user decide where it goes.

For a follow-up that belongs with the code, add it to [`docs/plans/dalib-ts-followups.md`](docs/plans/dalib-ts-followups.md).

## Where the format truth lives

The authoritative specification of the client file formats is **not in this repo**. It is in the maintainers' document repo, which holds the `.dat` archive structure, the client executable internals, and the wire, opcode and CRC references. Read that specification before you guess at a format.

A parsing rule that turns out to be wrong is two changes, not one:

1. The fix in this repo.
2. A correction to the specification in the document repo.

Do not work around a wrong specification in code. A workaround leaves the next reader with the same wrong document.

Do not name the document repo in a commit message, a branch name, a code comment or a pull request body. Call it "the document repo". This repo is public.

## Build and test

| Command | Action |
| --- | --- |
| `npm test` | Runs the test suite with Vitest. |
| `npm run test:watch` | Runs the tests in watch mode. |
| `npm run test:coverage` | Runs the tests and reports coverage. |
| `npm run lint` | Type-checks with `tsc --noEmit`. |
| `npm run build` | Builds `dist/` with tsup. |

Some tests read a real Dark Ages client installation. `tests/clientAssets.ts` finds the client at `DALIB_CLIENT_DIR`, and it defaults to `e:/games/dark ages`. Set `DALIB_CLIENT_DIR` to your own install path.

**A skipped client test is not a passed test.** These tests skip when they do not find the archive they need. The reporter shows the same skip for "no client is installed" and for "the client is installed but the lookup failed". Confirm that the client tests run before you trust them.

## Branches

Cut every branch from `main`. Target every pull request at `main`. Do not base a branch on another feature branch.
