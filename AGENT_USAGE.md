# Agent Usage

How AI coding agents were used to build this project, what they got wrong, and how output was verified.

## Tools

| Tool | Used for |
|---|---|
| Claude Code (Claude Opus 5.5, VS Code extension) | Planning, scaffolding, writing code and tests, running verification commands |
| `create-next-app@16.3.8` | Next.js + TypeScript + Tailwind + ESLint scaffold |
| `shadcn` CLI | UI primitives / theme tokens |
| Prisma CLI 7.10 | Schema, migrations, client generation |
| Docker Compose | Local PostgreSQL |
| Vitest | Unit tests |

No subagents were delegated work so far; all work ran in a single agent session with the human reviewing each step.

## Log

### Session 1: Planning

**Prompt (summarised):** "Understand the requirements for the Release Communication and Readiness Brief Assistant and produce an implementation plan (architecture, folders, schema, pages, API routes, AI workflow, version comparison, validation, testing, deployment, prioritised plan) scoped to a short time budget. No code yet."

**Output:** an 11-section plan. Key decisions the human accepted:
- Stable item IDs (`FEAT-1`, `QA-2`, …) plus per-item content hashes are the basis for citations, version diffs and staleness, so none of these depend on the LLM.
- `ReleaseVersion` rows are immutable snapshots.
- A `mock` AI provider for deterministic tests and key-less demos.
- Release approval is a human-only transition, enforced in code.

### Session 2: Steps 1 & 2 (scaffold, schema, validation, hashing)

**Prompt (summarised):** "Proceed with Step 1 (scaffold Next.js/Tailwind/shadcn/Prisma/Docker/logger/API envelope/.env.example/Vitest, make it boot) and Step 2 (Zod release package schema, deterministic `validatePackage()`, stable hashing, focused tests). No AI workflow, full UI, or deployment yet. Then run the app, migration, tests and lint/typecheck, and fix errors."

**Work performed**
- Scaffolded Next.js 16 (App Router), Tailwind 4, shadcn/ui (radix base), ESLint.
- Set up Prisma 7 with the `@prisma/adapter-pg` driver adapter. The schema covers the full approved data model (`Release`, `ReleaseVersion`, `AnalysisRun`, `GeneratedStatement`, `FinalBrief`, `AppLog`), and the initial migration is applied.
- Added Docker Compose Postgres on port 5434.
- Added a structured JSON logger (`lib/log.ts`) and an API envelope (`lib/api.ts`). The envelope handles request IDs, request logging, `{data}` / `{error}` responses, Zod body parsing, and hides internal error details from clients.
- Added `GET /api/health` with a database check.
- Added the Zod package schema (`lib/schema/release-package.ts`), `validatePackage()` (`lib/domain/validate-package.ts`) and stable hashing (`lib/domain/hash.ts`).
- Wrote 46 unit tests covering validation, schema, hashing and the API envelope.

**Design decisions**
- **Shape and business rules are kept separate.** Zod only checks types, enums and ID prefixes, so incomplete drafts can still be saved as versions. `validatePackage()` returns errors (which block analysis and approval) and warnings (which don't), each with a dotted path and item ID for the UI. Putting required-field rules in Zod was rejected because it would make saving a draft impossible.
- **Explicit "none" declarations** for known limitations and migration notes. This lets the validator tell "intentionally empty" apart from "forgot to fill in".
- **The item hash excludes the item ID**, because the ID is the item's identity, not its content. Array order is treated as meaningful, and this is documented in the code.
- **When there is no QA evidence at all, the validator emits one `QA_EVIDENCE_EMPTY` warning** instead of an uncovered-item warning for every change, to cut noise.
- **`getDb()` creates the client lazily**, so importing it never requires `DATABASE_URL` (for example during `next build`).
- **Writing logs to the `AppLog` table is deferred** until there are domain routes that produce meaningful events. For now logs go to stdout as JSON.

**Agent mistakes and rejected suggestions**

| Issue | Resolution |
|---|---|
| The default `node` was v20.13, which is too old for Vitest 5 and Prisma 7 | Used the Homebrew Node 24 install, added `.nvmrc` and `engines` |
| The npm `latest` tag for `prisma` pointed at `8.0.0-rc.20` | Rejected the pre-release and pinned stable 7.10.0 |
| A Vitest peer-dependency conflict with `@types/node@^20` | Bumped `@types/node` to ^24 to match the runtime; rejected `--legacy-peer-deps` |
| `prisma init` writes agent skill folders (`.agents`, `.claude`, `.windsurf`, `skills-lock.json`) and a `prisma7.config.ts` | Ran it in a scratch directory only to inspect the Prisma 7 layout, then hand-wrote `prisma.config.ts` |
| The shadcn generator emitted a self-referencing `--font-sans: var(--font-sans)`, so the Geist font was never applied | Fixed to `var(--font-geist-sans)` |
| Prisma 7 `migrate dev` no longer generates the client, so the client was missing after the migration | Added `db:generate` and `postinstall: prisma generate` (also needed on Vercel, where the generated client is gitignored) |
| My first validator draft used `indexOf` to rebuild item paths | Refactored `listItems` / `listChangeItems` to return each item's index |
| A test used a `1n` bigint literal, which the scaffold's ES2017 target rejects (`tsc` failed) | Changed to `BigInt(1)` instead of changing the scaffold's compile target |
| Vitest warned that `vitest.config.ts` used ESM in a CommonJS package | Renamed it to `vitest.config.mts` |
| `next start` warned about a stray `package-lock.json` in the home directory and inferred the wrong root | Pinned `outputFileTracingRoot` in `next.config.ts` |
| Port 5433 was already used by another local project's Postgres | Used 5434 |
| `npm audit` reported 5 high-severity issues (`braces` via `eslint-config-next`, dev-only) | Rejected `npm audit fix --force`, which would downgrade `eslint-config-next` to v14 and break linting; noted as a known issue |

**Verification**

| Command | Result |
|---|---|
| `npm run db:up && npx prisma migrate dev --name init` | Migration `init` applied; `prisma migrate status` reports the database is up to date |
| `npm test` | 3 files, 46 tests passed |
| `npm run typecheck` (`next typegen && tsc --noEmit`) | Clean, after the bigint fix above |
| `npm run lint` | Clean |
| `npm run build` | Succeeded; `/` is static, `/api/health` is dynamic |
| `npm run start` → `curl /` and `curl /api/health` | `/` returned 200. `/api/health` returned `{"data":{"status":"ok","database":"ok"}}` with an `x-request-id` header |
| Stopped the database container → `curl /api/health` | 503 `SERVICE_UNAVAILABLE` envelope; the Prisma error was logged server-side as structured JSON and not leaked to the client |
| `npm run dev` → `curl /` and `curl /api/health` | Both 200, with no warnings |

I reviewed the test assertions to make sure they check exact codes and paths, not just that something was returned. Every validation rule has a positive case and a negative case.

### Session 3: Step 3 (release and version workflow end to end)

**Prompt (summarised):** "Build the release and version workflow end to end: release APIs (list/create/get, create version, get version, validate), immutable versions with change notes, realistic two-version seed data, the pages `/`, `/releases/new`, `/releases/[id]`, `/releases/[id]/edit`, AppLog persistence, Zod request validation with the existing envelope, focused tests, and an easy demo experience. No AI, review, compare, brief, approval or auth. Run tests, typecheck, lint and build, and manually verify the main flow."

**Work performed**
- **Service and routes:** `lib/services/releases.ts` is the only code that writes versions. It is used by both the route handlers and the server-rendered pages, and the routes are thin wrappers around it.
- **Immutability, enforced twice:**
  - The service only ever inserts version rows.
  - A PostgreSQL `BEFORE UPDATE` trigger on `ReleaseVersion` rejects any update. Deletes still cascade from `Release`.
- **Optimistic concurrency:**
  - Saving a version requires `baseVersionNumber`; if it is stale, the API returns `409 CONFLICT`.
  - Two saves racing for the same number hit the `@@unique([releaseId, versionNumber])` constraint, which is mapped to 409.
  - A package identical to the latest version returns `422 NO_CHANGES`.
- **Item IDs are never reused** within a release. The editor allocates IDs from the highest number used in any version, and the server rejects a reused ID with `ITEM_ID_REUSED`. Without this, deleting `FEAT-3` and later adding an unrelated `FEAT-3` would look like an edit to Compare and Staleness.
- **Validation before saving:** packages with blocking errors are rejected with `422 PACKAGE_INVALID`, and `details` carries `{ errors, warnings }`. Warnings are stored on the version.
- **Database error mapping:** connection failures return 503, unique violations 409, and missing records 404. Anything else returns a generic 500, and internal messages are never sent to the client.
- **AppLog persistence:**
  - Mutating requests and server errors are persisted with the request ID, route, status, duration, outcome and release/version IDs. A new `hc.annotate()` hook on the request handler supplies the release and version IDs.
  - The domain events `release.created` and `release.version.created` are persisted too.
  - Only identifiers, counts and error names or codes are stored, never package contents or raw messages.
- **UI:**
  - The releases list has empty, loading, error and not-found states, plus a "Load sample release" button.
  - One shared `PackageEditor` serves both the create and edit pages. It covers all eight sections. QA evidence links to change items through toggle chips, and "none" can be declared explicitly for limitations and migration notes.
  - Validation runs live in the browser, using the same Zod schema and `validatePackage()` as the server. Field-level errors appear inline, blocking errors and warnings are summarised in a sticky sidebar, and save success or failure is shown with the request ID.
  - The overview page shows the status, the latest package, validation results, a readiness checklist and the version timeline. Review, Compare and Brief are disabled "Soon" buttons.
- **Demo data:** `lib/sample-data.ts` holds "Billing Portal 4.2".
  - Between v1 and v2: 5 items modified, 3 removed, 3 added, the rest unchanged, plus the QA summary edited.
  - Both versions deliberately carry QA warnings (partial, not run, uncovered).
  - The data is created through the normal service code, from `npm run db:seed` (idempotent) or `POST /api/sample-release`.
- **Tests:** Vitest is split into `unit` and `integration` projects. Integration tests run against an auto-created `*_test` database and refuse to run against any other database.

**Design decisions**
- **Saving now requires a valid package.** In Step 2 I kept Zod to shape-only checks "so drafts can be saved". Step 3 explicitly asked to "validate the package before saving" and to block invalid packages, so blocking errors now prevent saving. The split itself is unchanged: Zod failures are `400 VALIDATION_ERROR` (malformed request), and rule failures are `422 PACKAGE_INVALID` (incomplete release). Drafts persist only in the open editor.
- **Server-rendered pages call the service directly** rather than fetching the app's own API. Browser components call the API for mutations. This avoids an internal HTTP hop and keeps one code path for business logic.
- **Mutations are API calls with `fetch`, not Server Actions**, so the browser hits the same versioned API that the tests exercise.
- **Per-item user groups** (`userGroups` on change items) are kept in the schema and preserved when editing, but not exposed in the editor. Package-level affected groups cover the requirement, and the extra UI wasn't worth it.

**Agent mistakes and rejected approaches**

| Issue | Resolution |
|---|---|
| Next 16 error boundaries receive `retry`, not `reset` as in older Next versions | I read `node_modules/next/dist/docs` before writing `error.tsx` and used `retry` |
| Pages that query the database would be prerendered at build time | Used `await connection()`, as Next 16 recommends |
| A circular import between `lib/api.ts` and `lib/db-errors.ts` | Moved `ApiError` to `lib/errors.ts` |
| My first trigger raised SQLSTATE `restrict_violation`, which Prisma reported as "Foreign key constraint violated", hiding the real cause. An integration test caught it | Added a follow-up migration that uses the default `P0001`. Rejected editing the already-applied migration, which would have caused a checksum mismatch and a database reset |
| `targetDate: "next week"` produced two identical errors, because Zod 4 runs `.refine` even after `.regex` fails. Caught by a route test | Switched to `z.iso.date()` |
| The Vitest config imported a `.ts` helper, which triggered Vite's "ESM in CommonJS" config-loader warning | Moved the logic into `vitest.config.mts` and passed the URL to global setup through `process.env` |
| The test config threw when `DATABASE_URL` was unset, which would have broken unit-only runs | It now resolves leniently, and global setup reports the real problem |
| API unit tests asserted on log lines, which the new silent log level suppressed | The tests stub `LOG_LEVEL=info` and mock `persistAppLog` |
| **Found in browser testing:** after the user fixed all errors, the "Resolve 7 blocking issues" alert stayed visible next to "No blocking errors" | The alert is now derived from the live blocking count instead of being stored as save state |
| **Found in browser testing:** saving with the database down returned 500 instead of 503. A connection failure while starting a transaction surfaces as a raw `pg-pool` `AggregateError` with code `ECONNREFUSED`, not a Prisma error | `mapDbError` now also checks raw driver error codes; added a unit test |
| **Found in browser testing:** the `app_log.persist_failed` warning passed an `event` key in its context, which overwrote the log line's event name | Reserved fields (`ts`, `level`, `event`) are now applied last; the context key was renamed `failedEvent`; added a unit test |
| Disabled Review, Compare and Brief buttons explained themselves only through a `title` tooltip, which disabled buttons usually don't show | Added a visible "Soon" label |
| React error #441 appeared in the console when the list page loaded with the database down | Investigated: it is React's redacted production Server Components error, and `error.tsx` handled it correctly. Not a bug, so no change |
| The first sample data had QA-5 followed by QA-7 | Renumbered so v1 removes QA-6 and v2 adds QA-7 |

**Verification**

| Check | Result |
|---|---|
| `npm test` | 8 files, **90 tests** passed (unit + integration against `release_readiness_test`) |
| `DATABASE_URL= npm run test:unit` | 67 unit tests passed with no database |
| `npm run typecheck`, `npm run lint` | Clean |
| `npm run build` | Succeeded; every data page and API route is dynamic, `/releases/new` is static |
| `npm run db:seed` twice | First run created v1 and v2 (3 and 1 warnings) with `release.created` and `release.version.created` rows in AppLog; second run skipped |
| psql: `UPDATE "ReleaseVersion"` | Rejected by the trigger; `DELETE` on the release cascades |

**Manual browser check.** I drove headless Chromium (Playwright, installed in a scratch directory and not added to the project) against `next start` with a throwaway database, took screenshots, and inspected them:
1. The empty state rendered.
2. "Load sample release" opened the overview with the v2 timeline and checklist.
3. In the editor, saving without a change note was blocked.
4. "Add feature" allocated `FEAT-4`, skipping the deleted `FEAT-3`.
5. Saving created v3, and an API comparison showed v1 and v2 byte-identical before and after.
6. Re-saving an unchanged package showed "Nothing to save" (server `NO_CHANGES`).
7. Submitting a blank new-release form showed 7 inline and sidebar errors, and the alert cleared once they were fixed.
8. Creating the release with 2 warnings succeeded.
9. A concurrent save in the background, followed by saving the stale edit, showed "A newer version exists".
10. With the database container stopped:
    - saving showed "Database is unavailable" (503);
    - the list page showed the error boundary;
    - an unknown release ID showed the not-found page.

### Session 4: Step 4 (AI workflow)

**Prompt (summarised):** "Implement the AI workflow. It needs:
- an `AIProvider` interface with OpenAI and mock providers, chosen through `AI_PROVIDER`; the app must work with the mock and no key;
- `POST …/analyze`, running a deterministic pre-check, an analysis call (strict structured output, Zod, one retry), citation safety, summary calls, and persisting `PENDING` statements plus an AnalysisRun;
- detection of unsupported QA claims;
- versioned prompts;
- structured logs;
- a first Review page;
- focused tests that never call the real OpenAI API.

It must not change `Release.status`, and must not implement review actions, compare or staleness yet."

**Work performed**
- **Deterministic layer:**
  - `lib/domain/qa-coverage.ts` classifies each change item as verified, partial, not_passed or uncovered.
  - `lib/domain/claims.ts` detects absolute claims and whether they are hedged.
  - `lib/ai/precheck.ts` blocks invalid packages and turns everything it can derive into **RULE** statements: coverage gaps, thin descriptions, breaking changes without migration notes, and absolute claims in items or QA without passing evidence. It also collects claim candidates to pass to the model as facts.
- **Provider layer** (`lib/ai/provider.ts`, `openai-provider.ts`, `mock-provider.ts`, `factory.ts`):
  - Providers only return raw text. Parsing, validation, retries and citation checks live in a single orchestrator, so the mock and OpenAI are held to exactly the same contract.
  - The OpenAI provider uses Chat Completions with `zodResponseFormat`, which turns the same Zod schemas into a strict `json_schema`. It loads the SDK lazily and wraps API errors and refusals without exposing the key.
  - The mock derives deterministic output from the same structured input the model receives, so it works for any package, not only the sample.
- **Prompts** live in `lib/ai/prompts/analysis.v1.ts` and `summaries.v1.ts`. They explicitly require:
  - use only the supplied data, and never invent items or IDs;
  - cite evidence;
  - treat item text and the QA summary as claims, not facts;
  - an absolute claim is unsupported unless a *passing* QA item verifies that exact property;
  - mark uncertainty;
  - never claim approval, readiness or deployment;
  - don't repeat findings already recorded by the deterministic checks.

  The summaries prompt adds: one idea per statement, no internal IDs in the non-technical text, and don't restate unsupported claims.
- **Citation safety** (`lib/ai/sanitize.ts`):
  - Every ID is checked against the analysed version.
  - Impact classifications must target a FEAT, FIX or CHG item; unsupported-claim evidence must be QA items.
  - Risks, claims and summary statements need at least one valid citation; missing-information statements may be package-level.
  - Duplicates of RULE findings are dropped.
  - Summary statements that state an absolute claim without hedging are dropped.
  - Everything dropped is logged (`analysis.invalid_citations_dropped`) and stored in the run's `rawOutput`. Citations are persisted as `{ itemId, itemHash }` using the version's stored hashes.
- **Orchestrator** (`lib/ai/run-analysis.ts`):
  - It creates an AnalysisRun with provider, model, prompt version, input hash and pre-check results.
  - Each model call gets exactly one retry, with the rejected output and the parse or schema error passed back to the model.
  - Provider errors (network, HTTP, refusal) are not retried.
  - On a final failure the run is marked FAILED with all raw outputs kept, and the API returns `502 ANALYSIS_FAILED` with the run ID.
  - On success, the statements and the run update are written in one transaction.
  - There is no code path that touches `Release`.
- **Database:**
  - Migration `analysis_statement_source` adds `GeneratedStatement.source` (RULE | AI), `GeneratedStatement.metadata` (claim text, reason, user groups) and `AnalysisRun.precheck`.
- **API:**
  - `POST /api/releases/:id/versions/:v/analyze` (`maxDuration` 120 s).
  - `GET /api/releases/:id/versions/:v/analysis`.
- **UI:**
  - `/releases/:id/review` has a version switcher, live re-validation, a Run/Re-run button with an elapsed-time loading state, a failure alert with Retry, a blocked state, and an empty state.
  - Statements are grouped into the six kinds with Rule/AI badges, impact or severity, quoted claims with reasons, citation chips (title and hash on hover), and "Pending review" status. A sidebar shows run metadata.
  - The overview's Review button is now live, and its checklist reflects the analysis status.
- **Sample data:** two realistic unsupported claims were added. CHG-2 "Fully tested across all invoice templates." has no QA at all, so a rule catches it. FEAT-1 in v2, "No performance impact on the Invoices page.", is covered only by an export throughput test, so it needs the model.

**Important decisions**
- **Rules first, then the model.** Anything computable (coverage, thin information, claims without passing QA) is a RULE statement and is given to the model as fact. The model is asked only for judgement: impact, other missing information, claims on *verified* items, risks and summaries. Reviewers can tell RULE from AI statements in the UI.
- **Drop rather than repair.** Ungrounded output is removed, never patched. A statement can't be "fixed" by guessing which item it meant.
- **The absolute-claim guard on summaries is heuristic.** It matches regexes and allows hedged wording such as "described as fully tested, but not verified". It is a safety net behind the prompt rules, not a replacement for them, and it is documented as such.
- **Analysis output is not split by schema field.** Analysis and summaries are separate calls so the summaries can use the validated analysis (unsupported claims, coverage), which helps preserve uncertainty.
- **Approve/Edit/Reject controls were not added.** The card leaves room for them in Step 5. Disabled placeholder buttons would add clutter without adding function.
- **Default `OPENAI_MODEL` is `gpt-4.1-mini`**, which supports strict json_schema. It can be overridden; any model with Structured Outputs works.
- **Re-running analysis creates a new run.** The Review page shows the latest successful run's statements plus the latest failure, if any. Older runs are kept.
- **"Load sample release" is now also in the list header**, not only the empty state, so reviewers with existing data can load the claim-bearing sample.

**Agent mistakes and rejected approaches**

| Issue | Resolution |
|---|---|
| Checking how to generate the schema | I confirmed `openai@7`'s `zodResponseFormat` accepts Zod 4 and emits strict-compatible schemas (all fields required, `additionalProperties: false`, nullable as `["string","null"]`) by running it before relying on it. Rejected `client.chat.completions.parse()`, because it would put parsing and retry semantics inside the SDK, where the mock couldn't share them |
| Expected drop counts in the hallucination test | Writing them out showed that `invalidIds` in the log included `FEAT-1`, a *valid* ID, carried by the unhedged-claim drop. Fixed so `invalidIds` only contains unknown or invalid IDs |
| The whole suite passed on its first run | Treated as suspicious. I mutation-tested it: accepting every cited ID caused 5 failures, and allowing 3 attempts caused 2. Code restored afterwards |
| My backup command for that mutation check also wrote a stray file to `/tmp` | Deleted immediately; scratch work belongs in the session scratchpad |
| Browser check: the "Analysis blocked" alert offered a Retry button that could never succeed, and the Review page trusted the stored validation result | Retry is hidden for `ANALYSIS_BLOCKED`, and the page re-validates the package on read with the same rules as the pre-check, so the Run button is disabled up front |
| Browser check: a provider-error attempt was only logged to stdout, so AppLog showed `analysis.started → analysis.failed` with no attempt | It is now persisted as `analysis.llm_attempt` with outcome `provider_error`; test added |
| My first browser script used a non-exact text selector that matched both the alert title and its message | Fixed in the script; the app itself was fine |

**Verification**

| Check | Result |
|---|---|
| `npm test` | 12 files, **134 tests** passed |
| Mutation check | Disabling the citation filter fails 5 tests; raising the retry limit fails 2 |
| `npm run typecheck`, `npm run lint`, `npm run build` | Clean; new routes are dynamic |
| Client bundle | `.next/static` has 0 files mentioning `OPENAI_API_KEY`, `api.openai.com` or `chat.completions`; the SDK appears only in server chunks |

The new tests cover:
- **Pre-check:** coverage classes, claim detection and hedging, RULE statements.
- **Sanitizer:** hallucinated IDs, risks and summaries requiring citations, impact on non-change items, QA-only claim evidence, deduplication against rules, the unhedged-claim guard.
- **Providers:** the mock is deterministic and schema-valid with zero dropped output; the factory defaults to mock and never constructs the OpenAI client; the OpenAI request uses a strict json_schema, includes the retry messages, maps usage, and wraps 401 errors and refusals without the key.
- **Integration:**
  - the mock happy path stores PENDING statements whose citation hashes match the version, with both RULE and AI claims;
  - `Release` is unchanged, including when its status is already IN_REVIEW;
  - `AI_PROVIDER=mock` never constructs the OpenAI client;
  - one retry includes the error;
  - two invalid outputs (analysis or summaries) mean FAILED, raw output kept, no statements;
  - provider errors are not retried;
  - hallucinated output is dropped and logged;
  - the pre-check blocks a legacy invalid version and creates no run;
  - the routes return 201, 404, and 503 when `openai` has no key.

**Manual browser check.** I drove headless Chromium against `next start` with a throwaway database and two servers sharing it:
- **Mock server:** `AI_PROVIDER=mock`.
- **Failure server:** `AI_PROVIDER=openai`, a dummy key, and `OPENAI_BASE_URL` pointed at a closed local port. This exercises the real OpenAI provider's failure path with no external traffic.

What I checked:
1. The sample loaded, and Review showed the "No analysis yet" empty state.
2. On the failure server, running analysis showed "Analysis failed … OpenAI request failed" with Retry, and a FAILED run was stored (attempts 1).
3. On the mock server, the stored failure showed; Retry showed the loading state, then 34 statements across all six groups.
4. All 34 showed "Pending review"; all 46 citation chips were real item IDs, with 0 hash mismatches.
5. Both planted claims were flagged: CHG-2 by a rule and FEAT-1 by the mock model.
6. The release status stayed `DRAFT`, and the checklist showed "AI analysis generated: done".
7. AppLog held the full event sequence:
   - failed run: `analysis.started`, `analysis.llm_attempt`, `analysis.failed`;
   - successful run: `analysis.started`, then `llm_attempt` / `output_validated` twice, then `analysis.completed`.
8. For a legacy invalid version inserted with SQL, the Run button was disabled with an explanation, a direct API call returned `422 ANALYSIS_BLOCKED (QA_SUMMARY_MISSING)`, and no run was created.
9. The dummy key appeared 0 times in server logs, AppLog, AnalysisRun errors and raw outputs.

### Session 5: Step 5 (human review of generated statements)

**Prompt (summarised):** "Implement human review end to end:
- `PATCH /api/statements/:id` (approve, reject or edit; reviewer required; non-empty edits; `aiContent` preserved; audit-logged);
- statement cards showing kind, content, edit, source, citations, status, level, reviewer and a stale placeholder, with status-dependent actions, confirmations and an inline editor;
- a review summary with counts and a readiness message;
- a human-only guarantee (AI can't set reviewed statuses; `Release.status` unchanged), with tests;
- the required UX states, docs, and the full check suite plus a browser walkthrough.

No compare, staleness, brief or release decision yet."

**Work performed**
- **Domain** (`lib/domain/review.ts`):
  - The request schema is a Zod discriminated union on `action`. The reviewer is required and trimmed; edit content must be non-empty; an optional note is allowed on reject.
  - The transition matrix is `ALLOWED_ACTIONS`. Every decision is reversible; only the no-ops (approve when approved, reject when rejected) are refused.
  - `summarizeReview()` produces the counts.
- **Service** (`lib/services/review.ts`) is the only writer of `reviewStatus`:
  - It checks that the statement belongs to the **latest successful run** of an existing version (409 if superseded).
  - It applies the transition and refuses an unchanged edit with 422.
  - It writes with **compare-and-set** (`updateMany where reviewStatus = <read status>`), so a concurrent review returns 409 instead of silently overwriting.
  - It records `statement.reviewed` with statement, version, release and run IDs, action, reviewer, from/to status, timestamp and request ID. Only the length of edited text is logged, not the text.
- **Route:** `PATCH /api/statements/[statementId]` uses the existing envelope: 400 for validation errors, 404, 409, 422.
- **Database** (migration `statement_review`):
  - adds `reviewNote`;
  - an INSERT trigger: statements must be created PENDING and unreviewed;
  - an UPDATE trigger: generated fields (`aiContent`, citations, kind, source, level, metadata, run, version) are immutable;
  - CHECK constraints: a non-PENDING status needs a non-blank reviewer and `reviewedAt`, and EDITED needs non-empty `editedContent`.
- **UI:**
  - `StatementCard` (client) shows a kind label, level, a Rule/AI badge, a stale placeholder, the status badge, the edited content with the original expandable underneath, citations, and "Approved by X · time · note".
  - Actions depend on the status. Approve and reject use inline confirmation, and reject accepts a note. The inline editor is pre-filled, Save is disabled when empty or unchanged, and success or error feedback (with request ID) is shown.
  - The reviewer name is held in `useSyncExternalStore` over localStorage, with an empty server snapshot so there is no hydration mismatch and a fallback for when storage is unavailable.
  - A `ReviewSummaryPanel` has count tiles and a readiness message.
  - The page has an "Analysis in progress" state for a RUNNING run, plus a "No statements to review" empty state.
  - Re-running analysis asks for confirmation when reviews exist.
  - The overview checklist's "AI statements reviewed" item is now live.

**Important decisions**
- **Defence in depth for "human-only".** The API rules are backed by database triggers and constraints, plus a unit test that scans the source: `lib/ai/**` must never mention `APPROVED`, `EDITED` or `REJECTED`, update statements or update releases, and `lib/services/review.ts` must be the only application file that updates `generatedStatement`.
- **"Edited" counts as human-reviewed.** Approving an edited statement keeps the edited text as the effective content (`content = editedContent ?? aiContent`). Editing an approved statement moves it back to EDITED so the change is visible.
- **Statements from a superseded run can't be reviewed**, so a stale tab can't modify review state the reviewer can no longer see. The UI surfaces this as an error on the card.
- **The reviewer name is self-declared**, since authentication is out of scope. It is required and recorded on every action and in the audit log.
- **Inline confirmation instead of modal dialogs.** It is less code, needs no new dependency, and keeps the context visible.

**Agent mistakes and rejected approaches**

| Issue | Resolution |
|---|---|
| My first "only the review service writes statements" scan matched `lib/generated/prisma/...`, Prisma's generated client, which documents every model method | Excluded generated code from the scan |
| My first browser run read the reviewer field before hydration and reported it empty after reload | Confirmed with a separate script that it does persist; the driver now waits for network idle |
| The browser run showed that re-running analysis silently discards review progress (the overview went back to "34 of 34 pending") | Added a confirmation stating how many reviews will be superseded |
| The Docker CLI hung mid-session (`docker compose exec` and `docker ps` returned nothing), so the whole verification pipeline stalled. Postgres itself stayed reachable on 5434 | Killed the hung CLI processes and switched the e2e database setup and checks to the host `psql` over TCP |
| After killing those processes, the chained shell command continued past the `;` and ran its own migrate | I noticed "No pending migrations" on a database I had just created, checked the database and the running processes (empty data, only my server), and only then continued |
| Lint warned about unused destructured variables in a test | Rewrote the test to build the insert explicitly |
| Considered a modal dialog component (shadcn `dialog`) for confirmations | Rejected in favour of inline confirmation (above) |

**Verification**

| Check | Result |
|---|---|
| `npm test` | 14 files, **175 tests** passed (41 new) |
| Mutation check | Allowing approve→approve fails 2 tests; allowing a blank reviewer fails 2. Code restored |
| `npm run typecheck`, `npm run lint`, `npm run build` | Clean |

The new tests cover:
- **Unit:** the schema (missing or blank reviewer, empty or missing content, unknown action, client can't send a status), all 10 allowed transitions and 2 refused no-ops, no transition back to PENDING, summary counts, the checklist review item, and the source-scan guarantees.
- **Integration (real route and database):**
  - approve, reject with note, and edit (`aiContent` and citations unchanged);
  - 400 for an empty edit, missing or blank reviewer, and an invalid action;
  - 404, and 422 for an unchanged edit;
  - rejected → edit → approve, and approved → edit → edit again;
  - approved → reject;
  - 409 for no-ops and for superseded runs;
  - an audit row for every action with all required fields, and no edited text in the logs;
  - `Release` unchanged after approving every statement;
  - correct counts;
  - the database refuses inserting an APPROVED statement, overwriting `aiContent`, or a reviewed status without a reviewer.

**Browser walkthrough** (headless Chromium, `next start`, `AI_PROVIDER=mock`, fresh database):
1. Ran mock analysis: 34 PENDING statements (tiles 34/34/0/0/0).
2. Approve without a reviewer name was refused with "Enter your reviewer name".
3. Edited a statement:
   - the editor was pre-filled with the current content, and Save was disabled when emptied;
   - after saving, the database showed EDITED, `aiContent` identical to the original, and `reviewedBy` "Ada Reviewer";
   - the original text was visible under "Original … content (preserved)".
4. Approved a statement, which showed "Approved by Ada Reviewer · time".
5. Rejected one with the note "Rationale too generic". The card was struck through, with only Edit and Approve offered.
6. Edited the rejected statement (EDITED), then approved it (APPROVED, showing the edited text).
7. The tiles updated to pending 31, approved 2, edited 1, matching the database counts.
8. The reviewer name persisted across reload.
9. Re-run analysis asked for confirmation ("3 statements have already been reviewed…"), which I cancelled.
10. After a run was started in the background, approving a statement from the old run showed the error "This statement belongs to a superseded analysis run…" with the request ID.
11. The release stayed `DRAFT`. The audit trail recorded edit, approve, reject, edit, approve, each with from→to status and reviewer.
12. There were no page errors. Viewport screenshots of the summary tiles and the approved, edited and rejected cards were inspected.

### Session 6: Step 6 (version comparison and stale statements)

**Prompt (summarised):** "Implement version comparison and stale statement detection on the existing immutable-version and item-hash architecture:
- `GET /api/releases/:id/compare?from&to` (added, removed, modified, unchanged; field-level and package-level diffs; stale statements);
- staleness from citation hashes, plus conservative section and QA rules;
- real STALE status and reasons on Review, so stale statements can't be used in the brief;
- a Compare page and overview updates;
- API errors; focused unit and integration tests; a browser walkthrough.

No brief, release decision or deployment."

**Work performed**
- **Domain:**
  - `lib/domain/diff-versions.ts` matches items by ID and classifies them by stored hash, with field-level diffs, QA coverage diffs (covering evidence whose content changed is flagged "evidence updated"), package-level diffs, changed sections and counts.
  - `lib/domain/staleness.ts` applies three rules: citation hash or removal, QA dependency, and relevant section.
- **Services:**
  - `lib/services/compare.ts` produces the comparison read model.
  - `getReviewData` (in `lib/services/analysis.ts`) returns statements for a version: its own latest successful run, or the most recent earlier run carried forward, each assessed against the current version.
  - The review service refuses to approve or edit a stale statement (409 with reasons); rejecting is still allowed.
- **API:**
  - New: `GET /api/releases/:id/compare`. Query is checked with Zod (positive integers): 400 for the same version or invalid/missing numbers, 404 for an unknown release or version. Uses the request ID and structured `compare.completed` log.
  - `GET …/versions/:v/analysis` now returns the staleness-aware review data.
- **UI:**
  - `/releases/:id/compare` has client-side From/To pickers (the other side's version is disabled; a same-version URL shows a warning), the version change notes, a summary chip bar, Added/Removed lists, Modified items with before/after field diffs and QA coverage, QA coverage changes on unchanged items, package-level changes, stale statements with "Statement #n · kind · STALE · reason", and a collapsible Unchanged list.
  - Review shows `STALE — <reasons>` on cards, highlights the changed citation chips, offers only Reject on stale cards, shows a real Stale tile with an explanatory alert, a "Showing statements from the vN analysis" notice, and an older-version note.
  - Overview: the Compare button is live, version history links to Review and Compare per version, plus a stale banner and new checklist items ("No stale statements", outdated analysis).

**Important decisions**
- **Staleness is computed on read, against the current version.** Nothing is stored or mutated, citations keep their original hashes, and earlier statements stay attached to their original run and version (tested). The Compare page evaluates the `from` analysis against `to`.
- **Statements are carried forward.** A new version doesn't wipe the review: the latest version's Review page shows the previous analysis's statements, with only the affected ones marked STALE. Fresh carried statements can still be approved.
- **Stale statements can only be rejected**, enforced in the UI and the API. An edit or approval can't make a statement fresh, because its citations would still point at old evidence. Re-running analysis is the way to regenerate it.
- **Precise rules first, conservative ones only where nothing anchors the statement.** Cited statements become stale only through their own citations and the QA evidence covering the items they cite. Section rules apply only to uncited statements and to missing-information gaps (gap-filling sections only).

**Agent mistakes and rejected approaches**

| Issue | Resolution |
|---|---|
| My first section rule applied keyword-matched sections to all MISSING_INFO statements. "CHG-2 has no QA evidence" would have gone stale whenever any QA item changed, the "everything stale" behaviour the prompt warned against | Restricted cited MISSING_INFO to gap-filling sections and left QA gaps to the precise QA-dependency rule; a test covers the unrelated-QA case |
| A smoke run over sample v1 → v2 (39 statements) showed the v1 FEAT-2 *impact* statement ("QA status: only partially verified") was not flagged after QA-2 started passing, because IMPACT wasn't treated as depending on QA | A statement now also depends on QA when its text mentions QA, testing or verification; unit test added |
| Screenshot review: FEAT-1's QA coverage showed "QA-1 (pass) → QA-1 (pass)". It was technically a change (QA-1's content changed) but looked like nothing | The covering evidence is now labelled "evidence updated" |
| Screenshot review: long labels in the Added/Removed lists wrapped under the ID | Switched the rows to a two-column grid |
| Carried-over statements can cite removed items (FEAT-3), whose chips would read "Unknown item" | The Review page merges item labels from the source version |
| Rejected: storing a `stale` flag on statements | Would mean mutating statements and going out of date whenever a version is added; computing on read is cheap and always correct |
| Rejected: letting a reviewer "re-confirm" a stale statement against the new version | Would require rewriting citation hashes, which the prompt forbids |
| The Docker CLI was still unresponsive | All database setup and checks went through host `psql` on port 5434 |

**Verification**

| Check | Result |
|---|---|
| `npm test` | 17 files, **211 tests** passed (36 new) |
| Mutation check | Disabling the citation-hash comparison fails 4 tests; disabling the QA-dependency rule fails 4. Code restored |
| `npm run typecheck`, `npm run lint`, `npm run build` | Clean; `/api/releases/[releaseId]/compare` and `/releases/[releaseId]/compare` are dynamic |

The new tests cover:
- **Diff (unit):** an identical package; added, removed, modified and unchanged by ID; reordering is not a change; field-level diffs (description, user groups, breaking, QA result); QA coverage change on an unchanged item; evidence-updated flag; package-level changes (QA summary, groups added and removed, none-declared).
- **Staleness (unit):**
  - stale: cited item modified; cited item removed; citation hash mismatch;
  - not stale: cited item unchanged; unrelated item modified;
  - QA evidence added for a cited item makes dependent statements stale; a changed cited QA item is reported (both reasons);
  - an impact statement depends on QA only when its text mentions verification; QA for other items doesn't count;
  - uncited summary with a relevant section changed: stale; with an unrelated section changed: not stale; with no section named: stale on any change;
  - missing information with the gap-filling section changed: stale; with unrelated changes, including unrelated QA: not stale;
  - same version: never stale.
- **Integration (real API):**
  - compare 1→2 shows the exact added, removed and modified sets, counts, FEAT-1 and QA-2 field diffs, the QA summary change, and stale statements with expected reasons, with nothing citing FIX-1 marked stale;
  - stale + fresh equals the total;
  - original statements and citation hashes are unchanged after comparing;
  - with no analysis, nothing is stale;
  - 400 for same, 0, abc or missing versions; 404 for a version that doesn't exist and for an unknown release or a version from another release;
  - review data carries v1 statements to v2 with only some marked stale; a fresh v2 analysis has none;
  - approve or edit of a stale statement returns 409, reject returns 200, a fresh carried statement can be approved;
  - a new version leaves old statements attached; the release stays DRAFT.

**Browser walkthrough** (headless Chromium against `next start`, `AI_PROVIDER=mock`, fresh database):
1. Loaded the sample. Version history showed "Review" and "Compare with v1" links.
2. Opened Review for v1 from the timeline and ran mock analysis (39 statements).
3. The overview showed "24 of 39 statements are stale for v2", and the checklist said "24 statement(s) cite items that changed".
4. Compare (from the overview button) opened `?from=1&to=2`:
   - chips: 3 added, 3 removed, 5 modified, 9 unchanged, 1 package-level change, 24 stale statements;
   - Added FIX-3, QA-7, MIG-3; Removed FEAT-3, QA-6, LIM-2;
   - FEAT-1 Description and QA-2 Result/Notes shown before and after; QA summary before and after;
   - the stale list started "Statement #1 · Impact · STALE · FEAT-1 was modified".
5. In the picker, the same version was disabled on each side; `?from=2&to=2` showed "Choose two different versions"; changing the picker navigated.
6. Review for v2 showed "Showing statements from the v1 analysis":
   - 39 cards, 24 with STALE; the stale tile, the API and Compare all said 24;
   - reasons such as "FEAT-1 was modified", "QA evidence for FEAT-2 changed", "FEAT-3 was removed; QA-6 was removed";
   - stale cards offered only Reject;
   - fresh cards (FIX-1, FIX-2, CHG-2 impact) offered Edit, Approve and Reject, and approving one worked.
7. The release stayed `DRAFT`, with no page errors. Viewport screenshots of Compare (header, Added/Removed, Modified diffs) and Review (STALE cards) were inspected; the two layout issues above were fixed and re-verified.

### Session 7: Step 7 (final brief and human release decision)

**Prompt (summarised):** "Implement:
- `POST /api/releases/:id/brief`: a deterministic brief from the current version's APPROVED or EDITED, non-stale statements, with citations, persisted as FinalBrief, and 422 when blocked;
- the `/releases/:id/brief` page with copy and Markdown download;
- `POST /api/releases/:id/decision`: a human approve/reject guarded by the readiness conditions, with rejection reversible;
- human-only status changes enforced at the service and database level;
- overview updates; tests; a 16-step browser walkthrough.

No authentication, PDF, deployment or new AI."

**Work performed**
- **Domain** (`lib/domain/brief.ts`, `lib/domain/decision.ts`):
  - `briefBlockers()`, `selectBriefStatements()`, and deterministic `assembleBrief()`: fixed section order, each statement exactly once, Markdown escaping, citations on every line, and a Sources list with item hashes. There is no timestamp in the Markdown.
  - `approvalBlockers()` adds "brief missing" and "brief outdated" (re-assembly no longer matches the stored Markdown).
  - Zod request schemas.
- **Services:**
  - `lib/services/readiness.ts`: one read model for the current version (validation, staleness-aware review data, blockers, assembled brief, latest brief, whether it is up to date). It is used by both APIs, the overview and the Brief page.
  - `lib/services/brief.ts`: generates the brief, returning the existing one if nothing changed, and logs `brief.generated` / `brief.blocked`.
  - `lib/services/decision.ts`: approve is guarded, reject is always allowed. Uses compare-and-set and logs `release.decided` / `release.decision_blocked`.
- **Database** (migration `release_decision`): adds `Release.decidedVersionNumber`, an INSERT trigger (DRAFT and undecided only), an UPDATE trigger (APPROVED or REJECTED needs a new decidedAt, decidedBy and decidedVersionNumber), and a CHECK constraint.
- **UI:**
  - The Brief page has: a decision banner, the reviewer field, a blocked card with a link to fix each blocker, an empty state with Generate, the brief document with an outdated warning and Regenerate, Copy and Download, the included statements (with who approved or edited each), a readiness checklist, and a decision panel (note, confirmation, Approve disabled with listed blockers, Reject).
  - `BriefDocument` renders exactly the Markdown subset the brief uses, through React (no raw HTML), with citation chips.
  - The overview's Brief button is live, the decision banner shows APPROVED or REJECTED with the note (and warns if the decision was for an older version), and the checklist's brief and decision items are live.

**Important decisions**
- **The brief is deterministic, which is also the approval guard.** Because the same reviewed statements always produce byte-identical Markdown, approval can check that the stored brief is still exactly what the current reviews produce. Any review change after generation blocks approval until the brief is regenerated.
- **A brief is for one version.** It is tied to `versionId`; a new version means a new brief. Decisions record `decidedVersionNumber`, and the UI flags when the decided version isn't the current one. Status is *not* reset when a version is added, because only the decision endpoint may change status.
- **Carried-over statements are allowed** if they are fresh, but `UNANALYSED_ITEMS` blocks the brief when change items were added after that analysis. Otherwise a new item could be silently missing from the brief.
- **A rejected stale statement doesn't block**, since it's excluded anyway. That's how a reviewer resolves staleness without re-running analysis.
- **Rejection needs no readiness checks**, keeps everything, and can be followed by more review and approval (tested).

**Agent mistakes and rejected approaches**

| Issue | Resolution |
|---|---|
| First test run: the "pending" case also reported `NO_USABLE_STATEMENTS`. Technically true, but it is only a consequence of the pending reviews | That blocker is now raised only when nothing is pending |
| A test helper used `reviewer: string \| undefined = "Ada"`, so passing `undefined` silently used the default and the "missing reviewer" test sent a reviewer. My test bug | Changed the sentinel to `null` |
| Rejected: putting a generation timestamp in the Markdown | It would break determinism and the "brief is up to date" check; the time is stored on the record and shown on the page |
| Rejected: a Markdown library (or `dangerouslySetInnerHTML`) for rendering | The brief format is generated by our own code, so a tiny React renderer for that subset avoids a dependency and any HTML injection |
| Rejected: resetting the release to DRAFT when a new version is saved | Only the decision endpoint may change status; the UI shows that the decision was for an older version instead |
| The Docker CLI was still unresponsive | Database setup and checks went through host `psql` on port 5434 |

**Verification**

| Check | Result |
|---|---|
| `npm test` | 19 files, **249 tests** passed (38 new) |
| Mutation check | Letting PENDING statements into the selection fails 1 test (the unit test; the integration tests can't reach that state because pending statements also block); disabling the outdated-brief check fails 2. Code restored |
| `npm run typecheck`, `npm run lint`, `npm run build` | Clean; the brief and decision routes and `/releases/[releaseId]/brief` are dynamic |

The new tests cover:
- **Unit:**
  - selection: approved and edited only, stale excluded;
  - every blocker code, a rejected stale statement not blocking, a pending stale statement reporting both;
  - assembly: deterministic regardless of input order, edited text used, rejected excluded, each statement once, section mapping, header metadata, citations on lines, Sources with hashes (items cited only by rejected statements are excluded), Markdown escaping;
  - approval guard: missing, outdated, matching, and carried blockers;
  - decision schema;
  - source scans: only `lib/services/decision.ts` updates releases, and the AI workflow and brief service never reference the decision service or endpoint.
- **Integration (real routes and database):**
  - brief blocked by NO_ANALYSIS, then PENDING; 400 without a reviewer;
  - brief has the exact approved and edited IDs, edited text in, original edited text out, rejected excluded, citations and Sources present; FinalBrief row fields; regeneration returns the existing brief; audit log written; status still DRAFT;
  - after a new version, approved statements go stale and block the brief; rejecting them gives a v3 brief without the stale content;
  - UNANALYSED_ITEMS after adding FIX-4; NO_USABLE_STATEMENTS; VALIDATION_ERRORS on a legacy invalid current version;
  - decision: 400 for a missing or blank reviewer or an invalid decision; approval blocked by pending (plus missing brief), by a missing brief, by an outdated brief, and by stale statements;
  - approval succeeds and records decidedBy, decidedAt, note and version, with a `release.decided` audit row (requestId, from→to, briefId);
  - reject with pending statements succeeds and deletes nothing, then review, brief and approval follow;
  - analysis on an APPROVED and on a REJECTED release leaves the row unchanged; generating a brief leaves the row unchanged;
  - the database refuses an inserted APPROVED release, a status change without decision fields, and a rejection without a reviewer.

**Browser walkthrough** (headless Chromium against `next start`, `AI_PROVIDER=mock`, fresh database; edits and rejections done through the UI, bulk approvals through the same PATCH endpoint):
1. Loaded the sample and ran v2 analysis.
2. The Brief page was blocked: "34 statement(s) are still pending review" with a link to Review. Generate and Approve were disabled, and the API returned `422 PENDING_STATEMENTS`.
3. Reviewed v2 (1 edited, 1 rejected in the UI, the rest approved).
4. Created v3 in the editor (FEAT-2 broadened). The brief was blocked: "2 statement(s) are stale for v3".
5. Re-ran analysis for v3 and reviewed every statement the same way.
6. Generated the brief:
   - 33 statements included, all APPROVED or EDITED; the rejected one was absent; the edited wording was present and the original absent;
   - 45 citation chips; sections What's Changed through QA / Validation, then Sources;
   - the included-statements panel listed 33.
7. Copy put exactly the stored Markdown on the clipboard. Download produced `billing-portal-4-2-v3-brief.md`, byte-identical to the stored Markdown.
8. Approved with the note "Ship in the Tuesday window.":
   - the banner read "APPROVED for v3 by Ada Reviewer";
   - the database had `APPROVED`, decidedBy, `decidedVersionNumber` 3 and the note; the audit log recorded approve DRAFT→APPROVED;
   - the overview badge said "Approved" and the checklist said "Approved by a reviewer".
9. Loaded a second sample release. Approve was disabled. Rejected it with a note, and the banner showed REJECTED, the note, and "Nothing was deleted…".
10. Ran analysis on the rejected release and approved a statement. The status stayed REJECTED and all 34 statements were kept.
11. There were no page errors. Viewport screenshots of the Brief page (banner, checklist, document sections with citation chips) were inspected.
