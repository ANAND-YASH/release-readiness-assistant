# Release Readiness Assistant

Release Communication and Readiness Brief Assistant: structured release packages, deterministic validation, AI-assisted analysis with citations, human review, and version comparison.

## Architecture

```
Release package (structured input, stable item IDs)
  → deterministic validation          Zod shape + validatePackage() rules; blocking errors prevent saving
  → immutable version                 snapshot + per-item SHA-256 hashes, never updated
  → AI analysis                       deterministic pre-check → model (OpenAI or mock) → schema + citation checks
  → human review                      every statement starts PENDING; approve / edit / reject by a named reviewer
  → version comparison / staleness    diff by item ID and hash; statements whose evidence changed become STALE
  → final brief                       assembled deterministically from approved/edited, non-stale statements
  → human release decision            approve (guarded) or reject; the only way release status changes
```

- **Stack:** Next.js 16 (App Router, route handlers, server components), TypeScript, Tailwind CSS with shadcn/ui, Prisma 7 with PostgreSQL, Zod for every request and model-output schema, and an AI provider interface with an OpenAI implementation (Structured Outputs) and a deterministic mock.
- **Layering:** route handlers are thin (parse with Zod → call a service → return the response envelope). Business rules live in pure, unit-tested modules under `lib/domain/`, persistence in `lib/services/`, and the AI workflow in `lib/ai/`.
- **Guarantees enforced in the database as well as in code:** versions are immutable; statements are created PENDING and their generated content can't change; a release can only become APPROVED or REJECTED together with a recorded human decision.

## Requirements

- Node.js ≥ 22.12 (`.nvmrc` pins 24)
- Docker (for local PostgreSQL)

## Local setup

```bash
cp .env.example .env
# DATABASE_URL=postgresql://postgres:postgres@localhost:5434/release_readiness?schema=public
# LOG_LEVEL=debug
# AI_PROVIDER=mock          # default; set to openai + OPENAI_API_KEY for real model calls

npm install              # also runs `prisma generate`
npm run db:up            # Postgres 17 on localhost:5434
npm run db:migrate       # apply migrations
npm run db:seed          # optional: demo release "Billing Portal 4.2" with v1 and v2
npm run dev              # http://localhost:3000
```

There is no need to type a package by hand. The releases page has a **Load sample release** button that creates the same demo release as `db:seed`. The demo's two versions differ in meaningful ways: items are added, removed and modified, and QA results change. It also contains deliberate unsupported claims for the AI workflow to find. To try the workflow, open the release and go to **Review → Run AI analysis**; this works with `AI_PROVIDER=mock` and no key.

Health check: `GET /api/health` returns `{"data":{"status":"ok","database":"ok"}}`, or a `503` error envelope when the database is unreachable.

## Scripts

| Script | Purpose |
|---|---|
| `dev` / `build` / `start` | Next.js |
| `test` | All tests (unit + integration). Integration tests need `npm run db:up` |
| `test:unit` | Unit tests only, no database needed |
| `test:watch` | Vitest watch mode |
| `typecheck` | `next typegen && tsc --noEmit` |
| `lint` | ESLint |
| `db:up` | Start local Postgres (Docker Compose) |
| `db:migrate` / `db:deploy` | Prisma migrate (dev / production) |
| `db:seed` | Create the demo release (idempotent) |
| `db:generate` | Regenerate Prisma client |

Integration tests use a separate database. By default it is `DATABASE_URL`'s database name with `_test` appended, or you can set `TEST_DATABASE_URL`. The tests create it and run migrations automatically. They refuse to run against any database whose name doesn't end in `_test`.

## Releases and versions

- **A release** has metadata (name, product, target date, status) and one or more **versions**.
- **A version** is an immutable snapshot that stores:
  - the release package (JSON),
  - a SHA-256 hash of every item (`itemHashes`),
  - a hash of the whole package,
  - the validation result.
- **Creating a release** creates version 1.
- **Editing** always creates a new version. It requires a change note and the number of the version the edit started from. If someone else saved in the meantime, the API returns `409`.
- **Immutability is enforced twice.** The service only ever inserts versions, and a PostgreSQL trigger rejects any `UPDATE` on `ReleaseVersion`.
- **Item IDs** (`FEAT-1`, `QA-3`, …) are never reused within a release, even after the item is deleted. Citations and diffs keyed by ID therefore always refer to the same item. Reusing an ID returns `ITEM_ID_REUSED`.
- **Validation:** packages with blocking validation errors are rejected (`422 PACKAGE_INVALID`). Warnings are stored with the version and shown on the overview.

## API

Every response uses an envelope: `{ "data": … }` on success, or `{ "error": { "code", "message", "details?", "requestId" } }` on failure. Every response carries an `x-request-id` header.

| Method & path | Purpose | Notable statuses |
|---|---|---|
| `GET /api/releases` | List releases with their latest version | 200 |
| `POST /api/releases` | Create a release and version 1 (`{ name, product, targetDate?, package }`) | 201, 400, 422 |
| `GET /api/releases/:id` | Release and version history | 200, 404 |
| `POST /api/releases/:id/versions` | Save a new version (`{ package, changeNote, baseVersionNumber }`) | 201, 400, 404, 409, 422 |
| `GET /api/releases/:id/versions/:v` | Version snapshot (package, item hashes, validation) | 200, 404 |
| `POST /api/releases/:id/versions/:v/validate` | Validate without saving: no body re-validates the stored version; `{ package }` dry-runs a candidate | 200, 400, 404 |
| `POST /api/releases/:id/versions/:v/analyze` | Run the AI workflow; returns the run and PENDING statements | 201, 404, 422, 502, 503 |
| `GET /api/releases/:id/versions/:v/analysis` | Statements to review for the version (own or carried over), each with staleness against the current version | 200, 404 |
| `GET /api/releases/:id/compare?from=&to=` | Item, field and package-level diff, plus stale statements of the `from` analysis | 200, 400, 404 |
| `POST /api/releases/:id/brief` | Generate the final brief from reviewed statements (`{ reviewer }`) | 201, 200 (unchanged), 400, 404, 422 |
| `GET /api/releases/:id/brief` | Latest brief for the current version, plus brief and approval blockers | 200, 404 |
| `POST /api/releases/:id/decision` | Human approve/reject (`{ decision, reviewer, note? }`) | 200, 400, 404, 409, 422 |
| `PATCH /api/statements/:id` | Human review: approve, reject (optional note) or edit a statement | 200, 400, 404, 409, 422 |
| `POST /api/sample-release` | Create the demo release | 201 |
| `GET /api/health` | Liveness and database check | 200, 503 |

`400 VALIDATION_ERROR` means the request was malformed. `422 PACKAGE_INVALID` means the package failed release rules, and its `details` contain `{ errors, warnings }`. Database outages return `503`, and unexpected errors return a generic `500`. In every case, details stay in the server logs only.

## AI workflow

`POST /api/releases/:id/versions/:v/analyze` runs these steps for one version (the code is in [lib/ai/](lib/ai/)):

```
version snapshot
 → deterministic pre-check   validatePackage() (blocking errors → 422 ANALYSIS_BLOCKED, no run created),
                             QA coverage per change item (verified / partial / not_passed / uncovered),
                             thin descriptions, breaking changes without migration notes,
                             absolute claims ("fully tested", "no performance impact", "all users are unaffected", …)
 → RULE statements           everything derivable without a model (coverage gaps, claims in items without passing QA)
 → analysis call             impact, missing info, unsupported claims, risks (strict JSON schema)
 → parse + Zod               invalid → retry once with the error → still invalid → run FAILED (502 ANALYSIS_FAILED)
 → citation checks           unknown IDs removed; impact must target a change item; claim evidence must be QA items;
                             risks / claims / summaries without a valid citation dropped; duplicates of rules dropped
 → summaries call            technical + non-technical, one statement per idea, each cited (same retry rule)
 → citation + claim checks   summaries that assert an absolute claim without hedging are dropped
 → persist                   GeneratedStatement rows (PENDING, citations as {itemId, itemHash} from this version)
                             and the AnalysisRun, in one transaction
```

- **Providers** ([lib/ai/factory.ts](lib/ai/factory.ts)):
  - `mock` is the default. It is deterministic and needs no key.
  - `openai` uses Chat Completions with strict Structured Outputs, generated from the same Zod schemas.
  - The OpenAI SDK is loaded lazily on the server, so it never reaches the browser bundle and is never loaded in mock mode.
- **Prompts** are versioned in [lib/ai/prompts/](lib/ai/prompts/) (`analysis.v1`, `summaries.v1`). The prompt version is recorded on every run.
- **AnalysisRun** records:
  - provider, model, prompt version, input hash, status;
  - latency, attempts, and token usage when the provider reports it;
  - error, raw outputs of every attempt, and dropped items;
  - the deterministic pre-check result.
- **Release status is never touched.** The analysis never approves, rejects or deploys anything; statements start as `PENDING` for human review.
- **Read endpoint:** `GET /api/releases/:id/versions/:v/analysis` returns the latest run and the statements of the latest successful run.
- **Review page:** `/releases/:id/review` lets you run or re-run the analysis, with loading, failure (Retry) and empty states. It shows statements grouped by kind, with Rule/AI source, impact or severity, and citation chips.

## Human review

Every generated statement starts as `PENDING`. On `/releases/:id/review`, a reviewer enters their name (kept in the browser; there is no authentication yet), then for each statement:

| Status | Available actions |
|---|---|
| PENDING | Edit · Approve · Reject |
| APPROVED | Edit · Reject |
| EDITED | Approve · Reject · Edit again |
| REJECTED | Edit · Approve |

- **Behaviour of each action:**
  - **Approve** and **Reject** ask for confirmation. Reject takes an optional note.
  - **Edit** opens an inline editor pre-filled with the current text. Empty text is refused.
  - The original generated text (`aiContent`) is always kept and can be expanded under an edited statement.
  - Every decision can be revised; the only refused transitions are approving an approved statement and rejecting a rejected one.
- **Review summary:** the top of the page shows total, pending, approved, edited, rejected and stale counts, and the analysis status. It states that every statement must be reviewed before a final brief can be generated.
- **Re-running analysis:** if statements have already been reviewed, re-running asks for confirmation, because the new run's statements start as PENDING again.
- **API:** `PATCH /api/statements/:id` with `{ action: "approve" | "reject" | "edit", reviewer, content?, note? }`.
  - It only works for statements of the latest successful run of a version. A superseded run returns 409.
  - It uses compare-and-set on the current status, so a concurrent review returns 409 instead of overwriting.
  - Every action is audited as `statement.reviewed`, with statement, version and release IDs, action, reviewer, from/to status, timestamp and request ID. Edited text is not logged.

**Human-only guarantees, enforced in the database as well as in code:**
- An insert trigger means statements can only be created as `PENDING` and unreviewed, so no generation path can insert an approved statement.
- An update trigger makes `aiContent`, citations, kind, source, level, metadata, run and version immutable.
- CHECK constraints require any non-PENDING status to have a reviewer and review time, and `EDITED` to have non-empty edited content.
- The review service is the only application code that updates statements. A unit test scans the source to keep it that way, and checks that the AI module never references a reviewed status or updates releases.
- Reviewing never changes `Release.status`.

## Version comparison and staleness

`GET /api/releases/:id/compare?from=<n>&to=<n>` and the page `/releases/:id/compare` (with From/To pickers that can't select the same version) compare two immutable versions:

- **Items are matched by stable ID** and classified using the item hashes stored on each version:
  - ID only in `to`: **added**;
  - ID only in `from`: **removed**;
  - in both with different hashes: **modified**;
  - same hash: **unchanged**.
- **Modified items** get field-level before/after diffs: title, description, user groups, breaking flag, QA result, covered items, notes, text.
- **Change items also get QA coverage diffs.** These appear even when the item itself is unchanged, and covering evidence whose content changed is flagged as "evidence updated".
- **Package-level changes** are reported for the QA summary, affected user groups (with added and removed groups) and the "none declared" flags.
- **Stale statements:** the latest successful analysis of `from` is evaluated against `to`.
- **Errors:**
  - 400 for the same version, invalid or missing numbers;
  - 404 for an unknown release, or a version that doesn't exist in this release (versions are addressed by number within a release, so another release's version can't be used).

**Staleness rules** ([lib/domain/staleness.ts](lib/domain/staleness.ts)). A statement generated for version A is stale relative to version B when any of these holds:

1. **A citation no longer matches.** The cited item was removed from B ("QA-1 was removed"), or its hash in B differs from the hash stored in the citation ("FEAT-2 was modified"). Citations are never rewritten, so the hash compared is always the one stored at generation time.
2. **The QA evidence it depends on changed.** This applies to statements about a cited FEAT, FIX or CHG item whose conclusions depend on QA: missing information, unsupported claims, risks, summaries, and any statement whose text talks about QA, testing or verification. If the set or content of the QA evidence covering that item changed, the statement is stale ("QA evidence for FEAT-2 changed") even when the item itself is unchanged.
3. **A relevant section changed:**
   - An uncited statement is stale when a section its text is about changes (keyword-matched: QA, migration, limitations, user groups, …). When the text names no section it is stale on any content change, since nothing anchors it.
   - A cited missing-information statement is also stale when a section that could fill the gap changes, for example migration notes for "no rollback plan".
   - Changes to unrelated sections never make a statement stale.

**Where staleness is used:**
- **Current version only.** Staleness is computed when a page or API reads the data, always against the release's current (latest) version, and never stored.
- **Review page:** for a version with no analysis of its own, the Review page shows the statements of the most recent earlier analysis, carried over and checked against the current version. Stale statements show `STALE — <reasons>`, the stale count is real, and their changed citations are highlighted.
- **Stale statements can only be rejected.** The API returns 409 for approve or edit until analysis is re-run, so they can't reach the brief.
- **Overview:** shows a stale banner and a "No stale statements" checklist item. Each entry in the version history links to Review and to Compare with the previous version.

## Final brief and human release decision

**Brief** (`POST /api/releases/:id/brief` with `{ reviewer }`, page `/releases/:id/brief`):
- **No model writes it.** [lib/domain/brief.ts](lib/domain/brief.ts) assembles it deterministically from the current version's statements that are **APPROVED or EDITED and not stale**, using the edited text where present. PENDING, REJECTED and stale statements are never included.
- **Sections:** What's Changed (technical-summary statements about features, fixes and changes), User Impact, Risks & Limitations, Technical Summary, For Users / Clients, and QA / Validation (unsupported claims, missing information), followed by Sources.
- **Each statement appears exactly once**, with its citations (`[FEAT-1, QA-1]`). Sources lists every cited item with its section, title and item hash.
- **The Markdown has no timestamp**, so the same reviewed statements always give byte-identical output. The generation time is stored on the `FinalBrief` record (`releaseId`, `versionId`, `markdown`, `statementIds`, `generatedBy`, `createdAt`). Regenerating with nothing changed returns the existing record.
- **Blocked with `422 BRIEF_BLOCKED`**, listing what to resolve, when any of these hold:
  - the package has validation errors;
  - there is no successful analysis;
  - change items were added after the analysis (carried-over statements);
  - statements are pending;
  - stale statements haven't been rejected;
  - there are no approved or edited statements.
- **The Brief page** shows release metadata, readiness checks, the blocked state with links to fix each problem, an empty state with Generate, the brief as a document, the exact included statements, and Copy / Download Markdown.

**Decision** (`POST /api/releases/:id/decision` with `{ decision: "approve" | "reject", reviewer, note? }`):
- **Approval is blocked (`422 APPROVAL_BLOCKED`)** unless every brief condition holds and a brief exists for the current version that is still up to date (`BRIEF_MISSING` / `BRIEF_OUTDATED`). "Up to date" means re-assembling the brief now reproduces the stored Markdown exactly.
- **Rejection is always possible and deletes nothing.** Reviewers can keep reviewing, regenerate the brief and decide again.
- **What is stored:** `status`, `decidedBy`, `decidedAt`, `decisionNote` and `decidedVersionNumber`, using compare-and-set. Each decision is audited as `release.decided`. If a newer version is created later, the overview says the decision was for an earlier version.

**Human-only guarantees:**
- `lib/services/decision.ts` is the only code that updates a release. A unit test scans the source to keep it that way, and checks that the AI workflow and brief service never reference the decision service or endpoint.
- **In the database:**
  - releases can only be created as DRAFT and undecided;
  - a move to APPROVED or REJECTED must record a new `decidedAt`, `decidedBy` and `decidedVersionNumber` in the same update;
  - a CHECK constraint requires those fields for any decided status.
- Tests show that analysis leaves an APPROVED or REJECTED release unchanged, and that generating a brief never changes status.

## Logging

- **Format:** structured JSON lines on stdout.
- **Persistence:** mutating requests and all server errors are also written to the `AppLog` table, along with domain events:
  - `release.created`, `release.version.created`;
  - `analysis.started`, `analysis.precheck_failed`, `analysis.llm_attempt`, `analysis.output_validated`, `analysis.retry`, `analysis.invalid_citations_dropped`, `analysis.completed`, `analysis.failed`;
  - `statement.reviewed`;
  - `brief.generated`, `brief.blocked`, `release.decided`, `release.decision_blocked`.
- **Fields:** each entry records the request ID, route, method, status, duration, outcome, and the release ID and version number where applicable.
- **Excluded:** package contents, request bodies and raw error messages are never persisted.
- **Failures:** writing to `AppLog` is best-effort and never fails a request.

## Testing

```bash
npm test             # unit + integration (Vitest); integration tests need PostgreSQL (npm run db:up)
npm run test:unit    # unit tests only, no database needed
npm run typecheck    # next typegen && tsc --noEmit
npm run lint         # ESLint
npm run build        # production build
```

The current suite has **249 passing tests across 19 files**.

- **Unit tests** (`tests/unit`) cover:
  - package schema and validation rules; stable hashing; item ID allocation;
  - the API envelope, error mapping and log persistence;
  - the AI pre-check, claim detection and citation sanitizer;
  - the mock and OpenAI providers (with a mocked SDK; no real API calls);
  - review transitions, version diff, staleness rules, and brief assembly and blockers;
  - source scans proving that only the review service changes statement status and only the decision service changes release status.
- **Integration tests** (`tests/integration`) call the real route handlers and services against PostgreSQL:
  - release and version APIs, immutability triggers and the sample data;
  - the analysis workflow (retries, failures, dropped citations, pre-check blocking);
  - statement review and its audit log;
  - comparison and staleness;
  - brief generation and the human release decision, including the database guards.
- **Database:** integration tests run against a separate database (see [Scripts](#scripts)), which they create and migrate automatically.

## Completed / Excluded Scope

**Implemented:**
- release creation and editing with deterministic validation and immutable, hashed versions;
- a demo release (`db:seed` or the **Load sample release** button);
- AI analysis (impact, missing information, unsupported claims, risks, technical and non-technical summaries) with citations, strict structured output, one retry and citation safety, using the OpenAI or the mock provider;
- human review (approve, edit, reject) with an audit log;
- version comparison and stale statement detection;
- a deterministic final brief with Copy and Markdown download;
- a guarded human release decision;
- loading, empty, validation, success and failure states;
- structured application and AI workflow logs (stdout and `AppLog`);
- unit and integration tests.

**Intentionally excluded:**
- no authentication or authorization: the reviewer name is entered by the user and recorded with each action;
- no PDF export (the brief is Markdown);
- no background job or queue system: analysis runs within the request;
- no automatic deployment;
- the AI cannot approve, reject or deploy a release, and cannot approve, edit or reject statements.

## Limitations

- **Self-declared reviewer:** the reviewer name is stored in the browser and not authenticated.
- **Synchronous analysis:** it runs inside the request (route `maxDuration` 120 s), with no queue.
- **OpenAI not tested live:** the OpenAI provider was verified with a mocked SDK and an unreachable endpoint, not against the live API. The default `OPENAI_MODEL` is `gpt-4.1-mini`; any model with Structured Outputs works.
- **Heuristic guards:**
  - the absolute-claim guard on generated summaries is pattern-based, a safety net behind the prompt rules;
  - the section-based staleness rule is keyword-based, used only for uncited statements and missing-information gaps (cited statements use exact hash comparison).
- **New items and existing summaries:** a newly added item does not make existing summary statements stale. The Compare page shows it as added, and the brief is blocked (`UNANALYSED_ITEMS`) until analysis covers it.
- **Re-running analysis:** it creates a new set of PENDING statements; reviews of the previous run are not carried over. The UI asks for confirmation.
- **Stale statements can't be revived:** a reviewer can only reject a stale statement; re-running analysis regenerates it.
- **Decisions and later versions:** a decision is recorded for a specific version. Creating a newer version does not change the release status; the UI shows that the decision was for an earlier version.
- **Editor limitations:**
  - incomplete packages can't be saved as drafts (blocking errors prevent saving);
  - per-item user groups are kept but not editable in the editor;
  - there is no warning before leaving the editor with unsaved changes.
- **Older versions:** they are reachable through Review and Compare, but the overview only shows the latest package.
- **UTC timestamps:** times are displayed in UTC.

## Deployment

No hosting provider has been chosen yet; these are the generic production requirements.

- **Runtime:** Node.js ≥ 22.12.
- **Database:** PostgreSQL, reachable from the app.
- **Environment variables** (see `.env.example`; set them in the host's environment, never commit them):
  - `DATABASE_URL`: the production PostgreSQL connection string;
  - `AI_PROVIDER`: `mock` (the default; no key needed) or `openai`;
  - `OPENAI_API_KEY`: required when `AI_PROVIDER=openai` (server-side only);
  - `OPENAI_MODEL`: optional, used when `AI_PROVIDER=openai`;
  - `LOG_LEVEL`: optional.
- **Install with dev dependencies included.** `postinstall` runs `prisma generate`, and `db:deploy` uses the Prisma CLI, which is a dev dependency.
- **Steps:**

```bash
npm ci                 # installs dependencies and generates the Prisma client
npm run db:deploy      # apply Prisma migrations to the production database
npm run build          # production build
npm run start          # start the server (PORT is respected)
```

- **Check:** `GET /api/health` should return `{"data":{"status":"ok","database":"ok"}}`.

## Project layout

```
app/                       pages (releases list, new, overview, edit) + error/loading/not-found
app/api/                   route handlers (thin: parse → service → envelope)
components/package-editor/ release package editor (client-side validation via shared schema)
components/releases/       overview widgets (checklist, timeline, package summary)
components/review/         review page (run analysis panel, grouped statements)
lib/api.ts                 API envelope: request ids, logging, AppLog, error mapping
lib/services/releases.ts   release/version persistence (the only writer of versions)
lib/services/analysis.ts   analysis read models
lib/services/review.ts     human review of statements (the only writer of reviewStatus)
lib/services/compare.ts    version comparison read model
lib/services/readiness.ts  readiness of the current version (shared by brief, decision and pages)
lib/services/brief.ts      final brief generation
lib/services/decision.ts   human release decision (the only writer of Release.status)
lib/ai/                    AI workflow: pre-check, providers, prompts, schemas, citation checks, orchestration
lib/domain/                deterministic logic: validation, hashing, item IDs, diff, staleness, review rules, brief, readiness
lib/schema/                Zod schemas (package, request bodies)
lib/sample-data.ts         demo release v1 → v2
prisma/                    schema, migrations (incl. immutability trigger), seed
tests/unit, tests/integration
```
