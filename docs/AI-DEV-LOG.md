# AI-DEV-LOG.md

Development log for Spotted. Not a transcript — the decisions, failures, corrections, and
recoveries that shaped the product.

Entries are added at the end of each work session, most recent last. Failures are recorded
with the same weight as successes; a log containing only things that worked is not
evidence of an engineering process.

## How to write an entry

This log is the source for a narrated video. Write so that a reader can speak it aloud,
unedited, to someone who has never seen the code.

1. **Plain language first.** Say what happened before saying how. "The test runner would
   not start" comes before "vitest 5 requires Node 22". A term of art gets one short
   explanation the first time it appears.
2. **One idea per paragraph.** Each paragraph should stand alone as a spoken beat.
3. **Every entry follows the same four beats, in this order:** what we set out to do, what
   we decided and why, what broke, what changed because of it. Use those as headings when
   the entry is long enough to need them.
4. **Failures get the same space as successes.** Include the wrong first attempt, the error
   as it appeared, and how it was noticed. A recovery is only legible if the failure is.
5. **Decisions record the alternatives.** State the options considered, the one chosen, and
   the reason in one sentence. A decision without alternatives reads as an assumption.
6. **Use real numbers and real names.** "39 tests", "Node 22.23.2", `scoreAttempt`, not
   "the tests" or "a newer version". Refer to files by path so the video can cut to them.
7. **Write in past tense, as a record.** No "we will"; those go in the handoff note.
8. **Don't repeat SPEC.md or SYSTEM.md.** Link to the section instead. The log is about
   what happened, not what the system is.
9. **Close each phase with a short "Where this leaves us"** — two or three sentences a
   narrator can use to bridge into the next phase.

Section templates below contain HTML comments listing what to record. Delete the comment
once the section has real content.

---

## Phase −1 — Specification (claude.ai session, before any code)

The idea started as a Slack ritual at Howdy: a hidden-object image posted to `#challenge`,
players replying "FOUND", no verification and no ranking. The goal was to turn that into a
real timed game.

The specification was developed in conversation before implementation began, which is why
`docs/SPEC.md` exists as durable agent context rather than as documentation written after
the fact. Three decisions from that session changed the architecture.

### The ground-truth problem

**Original design:** upload a background and object images, let the image model composite
them, then ask a vision model where the objects ended up.

**Problem identified:** the coordinates would be inferred rather than known. A vision error
is invisible to the developer and fatal to a player — scoring, the post-game reveal, and
the leaderboard all depend on exact positions.

**Two candidate fixes:**

1. Invert the pipeline. Choose coordinates deterministically, then have the model blend
   each object into a crop at that location. Ground truth by construction.
2. Keep generation as-is, detect with vision, and have the game master confirm every
   position before publication.

**Chosen: 2.** Option 1 gives perfect ground truth but constrains composition — the model
can no longer choose a naturally-occluded placement, which is the thing it is good at.
Option 2 keeps composition quality and puts a human at the one point where exactness
matters. The game master drags five circles in a few seconds; that is cheap, and it makes
the authority explicit.

**Refinement that made option 2 workable:** vision alone confuses a placed object with a
similar object already in the background. Pixel-diffing the generated image against the
original background yields candidate regions deterministically, reducing vision's job from
an open search to labelling a handful of known candidates. Detailed in SPEC §5.3.

### Rejecting a "builder" agent

The first agent roster included `builder` and `reviewer`. `builder` was cut.

The main Claude Code session is the builder. Routing implementation through a subagent adds
a context hop and discards the context just accumulated, with no isolation benefit — and it
is precisely the "fictional agent role" pattern the competition brief warns about. The test
adopted and applied to every remaining agent: *does this need a different context, or
different tools?* If neither, it is a prompt, not an agent.

Four agents survived: `scout`, `image-pipeline`, `qa-playwright`, `integration-reviewer`.
Each justification is in SYSTEM.md §2.

### Game design, closed before implementation

One-shot submission with all object thumbnails visible. This surfaced a flaw in the
original scoring rule: all-or-nothing ranking works when players can retry until perfect,
but with a single attempt most players miss at least one object and the leaderboard would
usually be empty — a dead-looking product. Changed to rank by objects found, then time.

Full decision table in SPEC §11. Closing these before handoff mattered because three
parallel streams cannot tolerate an ambiguous contract.

### Correction made during this session

The hooks were first written in bash using `jq`. `jq` is not installed by default, and a
hook that cannot start fails *non-blockingly* — the harness would have been silently off,
with no error a judge or I would notice. Rewritten in Node, which a Next.js repo already
requires. Each guard path was then tested directly rather than assumed.

---

## Phase 0 — Contract and harness

*Claude Code session, 13 September 2026.*

### What we set out to do

Phase 0 builds the contract that the three parallel streams depend on: the database
schema, the shared TypeScript types, the scoring function, and the test that enforces the
product's central invariant — no object coordinates ever reach a player while a game is
active. Everything else in the project sits on top of these four files, so the session was
run with an explicit rule: stop and ask before deciding anything the specification did
not already settle.

### What we decided and why

The spec left nine decisions open. Each was put to the human as a multiple-choice question
with a recommended answer, and every recommendation was accepted. The four that change
how scoring works:

**How a circle is measured on a non-square image.** Coordinates are stored as fractions
— x as a fraction of image width, y as a fraction of image height. That means a circle in
pixels is an ellipse in stored coordinates unless the scoring function knows the image
shape. Options were: define the radius as a fraction of width and pass the image size into
scoring; define it against the shorter side; or ignore the problem and accept ellipses.
Chosen: fraction of width, with scoring scaling the vertical distance by height ÷ width. A
hit region is now a true circle on any image, and the test suite includes a 2:1 image where
the same offset is a hit vertically and a miss horizontally.

**Whether a marker exactly on the edge counts.** Chosen: yes, inclusive. The edge favours
the player. The scoring code compares squared distances rather than taking a square root,
so the boundary is exact rather than subject to rounding.

**Which "greedy nearest-match" to implement.** The spec says marker-to-object assignment is
greedy, but there are two greedy algorithms. One walks markers in the order they were
placed and gives each its nearest unclaimed object. The other lists every marker–object
pair that is within range, sorts all of them by distance, and assigns closest-first. The
second was chosen because the spec also says marker order carries no information, and only
the second algorithm is independent of click order. A consequence worth stating plainly: a
near miss never blocks another marker, because only hits are candidates. A test pins the
one case where greedy scores lower than an optimal assignment would, so the behaviour is
deliberate rather than accidental.

**Primary keys.** Database-generated UUIDs for every table except users, whose id is the
Clerk user id. Opaque, not enumerable, safe to put in a server-action payload.

Five smaller additions to the data model were approved in a second batch: a game title,
an explicit thumbnail order on objects, a four-value status for generation runs
(`queued`, `running`, `passed`, `failed`), an `adjustment` column on generation runs so the
retry loop's evidence is readable from the table alone, and a single pure function —
`projectGame` in `src/lib/visibility.ts` — as the one place every read path must pass
through before data reaches a client. The invariant test bites there.

### What broke

**The test runner would not start.** Running vitest produced `Cannot find package 'vite'`.
Two causes stacked: the `vite` package, a required peer of vitest 5, had never been
installed, and the shell was resolving Node to version 20.0.0 through an asdf shim, while
vitest 5 requires 22.12 or later. Fixed by pinning the project to Node 22.23.2 in
`.tool-versions` and `.nvmrc`, declaring the minimum in `package.json`, and adding `vite`
as a dev dependency. Without the pin, `npm run verify` — which the Stop hook runs — would
have failed on every machine that did not happen to have the right Node active.

**A boundary test failed, and the test was wrong.** The aspect-ratio boundary test placed
a marker at y = 0.55 against an object at y = 0.5 with a 1:2 image, expecting a distance of
exactly the radius. In floating point, 0.55 − 0.5 is not 0.05; it is 0.050000000000000044,
and the marker landed a hair outside. The implementation was correct. The test was rewritten
with values that are exact in binary (0.5, 0.625, 0.25) and passed. This is the kind of
failure the harness is for: the boundary case was explicitly required by the spec, and the
first attempt at testing it would have been silently unreliable.

**The type check failed on a file nobody had touched.** `src/app/layout.tsx`, as generated
by `create-next-app`, typed its props as `LayoutProps<"/">` — a global that Next.js writes
into `.next/types` only after the dev server has run once. On a fresh clone, `tsc` cannot
find it. Replaced with an explicit `{ children: React.ReactNode }` so `verify` passes in CI.

**`.env.example` was invisible to git.** The generated `.gitignore` ignores `.env*`, which
swallows the one env file that is supposed to be committed. Added `!.env.example`.

**The hooks did not fire.** This session wrote files through the shell rather than the
editor tools, and the `PreToolUse` and `PostToolUse` hooks match only `Edit` and `Write`.
The path guard and the per-file type check were bypassed for the whole session. Nothing
went wrong as a result — the full `verify` was run by hand and the Stop hook still gates
the turn — but a guard that can be stepped around is not a guard. Recorded below as a
correction to absorb.

### What changed because of it

- Node version is pinned and enforced; `verify` runs identically everywhere.
- The `Normalized` brand is applied at the database column
  (`doublePrecision(...).$type<Normalized>()`), so rows come out of the database already
  typed. Nobody has to remember to convert.
- The schema carries the invariants as `CHECK` constraints, not just as tests: coordinates
  in [0, 1], position columns all-or-none, a confirmed object must have a position, a
  published game must have a window, `ends_at` after `starts_at`, and one attempt per
  player per game as a unique index. A test also asserts the `games` table has no `status`
  column, so invariant 3 cannot regress by accident.
- The initial migration `src/db/migrations/0000_init.sql` was produced by
  `drizzle-kit generate`, never by hand.

### CI quality gate

The Stop hook guards a single session; CI guards `main`. The workflow in
`.github/workflows/ci.yml` runs eight checks in parallel on every pull request — lint,
type check, tests with coverage, secret scanning, dependency audit, code duplication, a
security scan, and unused code — and posts one comment on the PR showing each check's
previous value, current value, and delta.

The numbers are a ratchet: a PR fails if any metric gets worse, and a green merge to
`main` rewrites the baseline. Quality can only move one way. Mechanism in SYSTEM.md §5.4.
The pattern was lifted from an earlier project of the author's and adapted from pnpm and
Biome to npm and ESLint.

Setting the baseline meant getting to zero first, and the unused-code check found four
things on its first run. `@next/env` was imported directly by `drizzle.config.ts` but only
present as a transitive dependency of Next — now declared. `isHit` in `scoring.ts` was
exported and never called; deleted, with its comment folded into `scoreAttempt`.
`nanoid` is listed but unused until Stream A generates public ids; ignored with a note
rather than removed and re-added. `tailwindcss` looked unused because knip was not
following CSS imports; fixed by adding `.css` to the project glob, not by ignoring it.

The first CI run failed on every job that installs packages, in ten seconds each. Two
causes, found one after the other. First, `@types/node` was pinned to version 20 while
vitest 5 wants 22 or newer; the project already runs Node 22, so the types were simply
bumped. Second, and less obvious: the committed lockfile was built on a machine whose
global npm config had `legacy-peer-deps=true`, which quietly ignores peer-dependency
conflicts. CI runs `npm ci` strictly and refused the lockfile. A local `npm ci` had passed
because it read the same lenient config. Regenerated the lockfile with peers respected
and added a project `.npmrc` so a local install can never again differ from CI.

A third, quieter problem: the workflow was copied with a filter that ran it only on pull
requests targeting `main`. The CI branch was stacked on the Phase 0 branch, so its own PR
would never have been checked. Filter removed; every pull request is gated regardless of
base.

With those fixed, the gate went green on the CI PR, then on the Phase 0 PR once the two
were merged together, and finally on the first push to `main` — where the
`update-baseline` job made its first commit without a human touching it, raising the
coverage floor from the hand-set 81 to the measured 81.81. The reporter comment on the
Phase 0 PR read every row as ✅ with the coverage delta shown as +0.8. That is the loop
closing: the numbers the gate enforces are the numbers the gate measured.

Coverage is measured over `src/**/*.ts` only. Pages under `src/app` are UI, verified by
Playwright, and would drag the number without saying anything about correctness. First
baseline: 81% lines, everything else at zero. The E2E job is still missing — SPEC §8 calls
for it and it lands with the Playwright skeleton.

### Storage vendor change

Vercel Blob was replaced by Neon Object Storage before any upload code existed. `npx neon
init` was run with only Object Storage selected; it wrote `neon.ts` declaring one private
bucket, `assets`, and pulled the connection strings and S3 credentials into `.env.local`.
The CLI also offered Neon's managed Better Auth in place of Clerk. Considered and declined:
it would have replaced the `users` table with Better Auth's own tables inside the frozen
contract, and Clerk's shared dev credentials make Google sign-in zero-setup. The schema is
unchanged — image columns hold keys or URLs either way. SPEC §5.1 updated.

With a real connection string in hand, the initial migration was applied to the Neon dev
branch with `drizzle-kit migrate` rather than `db:push`, so the migration history is
recorded from the first table onward. Checked directly against the database afterwards:
six tables, fifteen `CHECK` constraints, one migration row, and an insert with `ends_at`
before `starts_at` rejected by `games_window_ordered`. `db:migrate` was added as a script
and CLAUDE.md now points at it over `db:push`.

### The review that stopped the freeze

Before handing off, an `integration-reviewer` agent — fresh context, never saw the
reasoning above — was pointed at the merged Phase 0 and asked whether the contract could
be frozen. Its answer: the pure code is sound; the contract is not ready. Four findings
rated HIGH, all accepted.

**The CI gate failed open.** Every metric job ran its tool with errors suppressed, parsed
the output with a fallback of zero, and compared with a shell test that treats an empty
string as "not greater than". A crashed linter, a semgrep install failure, or a registry
outage would report zero findings, pass, and — on `main` — write that zero into the
baseline permanently. The ratchet would have ratcheted the wrong way with no one noticing.
Fixed by moving the comparison into one script, `.github/scripts/gate.sh`, that refuses
any value that is not a number. Seven cases were run by hand before trusting it: pass,
regression, empty, garbage, missing baseline key. The reviewer also noticed that a PR
compared against the baseline at its own branch point, not `main`'s current one, so a
stale branch could pass while regressing against today's `main`. Now every PR reads
`main`'s baseline — unless the PR edits `quality-baseline.json` itself, which is the one
sanctioned way to lower a bar on purpose, and it shows in the diff.

**The invariant test tested a fixture, not the invariant.** `projectGame` took `status`
and `viewer` as inputs, so the two decisions that actually determine whether coordinates
go out — is this the master, and is the game over yet — lived outside the choke point and
outside the test. A caller passing the wrong viewer, or a status derivation with a `≥`
where a `>` belonged, would leak everything with the test green. `projectGame` now takes
a user id and a clock and decides both itself; `deriveStatus` moved into Phase 0 with
tests at every boundary; the invariant test now drives real times through `ends_at − 1ms`
and `ends_at`, and a user id that merely resembles the master's.

**"Rejected at the database level" was only true for Start.** The attempt row is created
when the player presses Start, so Submit is an update, and the unique index the spec
relies on rejects a second Start, not a second Submit. Chosen fix, over a separate
submissions table: Submit is a conditional update — `WHERE submitted_at IS NULL` — and a
row count of zero is the rejection. Probed against the live database: first submit
updates one row, second updates none, the score stands. While in there, `elapsed_ms`
became a column the database computes from its own two timestamps; a client value
cannot reach it because the column cannot be written at all. Invariant 5 by construction.

**Three streams would have invented the same types.** Nothing described a player's
attempt, a result, a leaderboard row, or a generation run as the master sees it. Added
now, and the result type is deliberately just count and time — the per-marker assignment
that scoring produces is the exact information SPEC §3.3.7 says a result must not reveal.

Four smaller changes from the same review: images are stored as bucket keys and signed
inside `projectGame`, so no read path can skip signing; `requested_scale` joined
`objects` because the validation predicate in SPEC §5.3 needs a number to compare; a
`CHECK` now forbids publishing without a generated image; and confirmation is defined as
"against the current image" — any regeneration resets it, and publish re-checks. Coverage
was rescoped to the pure core, `src/lib/**` minus the stream directories, because the
first server action would have breached a floor measured on three pure files.

### Where this leaves us

Phase 0 is merged to `main` as PR #1 with the CI gate (PR #2) folded in, and the review
fixes follow as their own PR. `main` is green on all eight checks and the schema is live
on the Neon dev branch. The handoff note is `docs/handoffs/phase-0.md`. The contract files — `src/db/schema.ts` and `src/lib/types.ts` — are frozen for
the three streams. Left to Stream A: the database client (the HTTP driver cannot run the
transaction that publication requires) and the URL signer. Still owed from the Phase 0 list in SPEC §7:
seed fixtures, the Playwright skeleton and its CI job, and the deterministic paste fallback.

---

## Phase 1 — Platform stream

*Claude Code session, 13 September 2026, branch `stream/platform`.*

### What we set out to do

Phase 1 is Stream A of SPEC §7: sign-in, game authoring, publishing, and the play-side
server logic — everything a game needs except image generation and the drawing surface.
It was the first phase built on the frozen Phase 0 contract, and the first run of a
different way of working: instead of one session writing every file, the session wrote a
plan of ten tasks and then dispatched a fresh subagent per task, followed by a fresh
reviewer per task, followed by one whole-branch review at the end. The orchestrating
session touched no code. Its job was to write briefs, read reports, and rule on conflicts.

### What we decided and why

Four decisions the spec left open were put to the human before planning, each with a
recommendation; all four recommendations were taken.

**How users reach the database.** Clerk is the identity provider; the `users` table is a
mirror. Options were a Clerk webhook (canonical, but needs a public URL and a signing
secret even in development) or a lazy upsert the first time a signed-in user calls any
server action. Lazy upsert won: no webhook, works identically on a laptop and on Vercel,
and the row refreshes name and avatar on every call for free.

**How images reach storage.** Browser straight to the bucket via a presigned PUT, or
through a server action. Vercel caps request bodies at 4.5 MB, which is fine for object
cut-outs and not fine for backgrounds, so presigned PUT — after first proving that the
bucket honours CORS and that a presigned PUT actually lands, since neither was
documented for Neon's storage.

**Where the play actions live.** Start, submit, and leaderboard could have waited for the
canvas stream in Phase 3. They carry three invariants — scoring server-side only,
server-anchored time, one submission per player — and they write to tables the platform
stream owns, so they were built now, with integration tests, and Phase 3 will build UI
against a tested contract rather than write into another stream's directory.

**Where integration tests get a database.** A dedicated Neon branch, its connection string
held as a GitHub secret. Tests truncate every table before each run, so the harness
refuses to start unless a separate `TEST_DATABASE_URL` is set — it will never point at
the development branch by accident.

One more decision was made during setup rather than before it. The `.env.local` file
already contained a `TEST_DATABASE_URL`, and it pointed at the same endpoint as the
development database. Had the first integration test run, it would have truncated the
dev branch. A `test` branch was created and the human was asked to repoint the variable
before any test was dispatched — the one moment in the phase where the orchestrator
stopped and waited.

### What broke

**The test config could not read its own environment.** The plan said to load
`.env.local` with the same helper Next uses. The helper skips `.env.local` whenever
`NODE_ENV` is `test`, and Vitest sets exactly that. The first implementer found it, read
the library's source to confirm it, and worked around it with a comment explaining why.

**A commit signed by the wrong model.** A Haiku subagent wrote a perfectly good task and
signed the commit as itself. Every later brief states the required footer verbatim.

**Invariant 4 was not race-safe.** The publish transaction locked the game row before
checking that every object was confirmed. But none of the *mutations* locked anything.
Under Postgres's default isolation, an object edit could read the game as a draft, wait
while publish committed, then write an unconfirmed position into a game that was now
live. The reviewer for that task — reading the code cold, with no memory of writing it —
found the hole; the plan's own reference code had it too. Every draft-only mutation now
runs in a transaction that takes the game-row lock first, and a deterministic test holds
the lock from a second connection, proves the edit blocks, publishes under the lock, and
proves the edit then fails with "not a draft."

**The prescribed fix for a hydration bug failed lint.** The window inputs converted UTC to
local time during server rendering — in the server's time zone, not the browser's. The
first fix, setting state in an effect after mount, is exactly the pattern React's newer
lint rule forbids, and the Stop hook caught it before the commit landed. The working
pattern uses `useSyncExternalStore` to know when the component is in the browser and
remounts the inputs once, so their initial state is computed in the right zone with no
effect at all.

**A missing secret rendered as a pass.** The CI job that runs integration tests skips its
steps when the database secret is absent — but a job whose steps are skipped still
reports success, so the PR comment showed a green tick for tests that never ran. The job
now publishes its own status (`pass`, `skipped`, or nothing), the report renders
`skipped` as a warning, and the baseline on `main` will not advance until the secrets
exist.

**Duplication only visible across tasks.** Each task's reviewer saw one diff. The
whole-branch reviewer saw that "load the game, lock it, require it's a draft" was written
out four times and "load by public id, require playable" twice, and that the server-action
wrappers had hand-copied their input types from the functions they wrap. The duplication
gate in CI would have failed on the first push. Two small helpers and `Parameters<typeof
fn>` types took the clone count from five to zero.

**Two things the same reviewer found that no test had asked about.** A game master could
hand `addObject` a storage key belonging to *another* game and receive a fresh signed URL
for it — closed with a prefix check, `isOwnedKey`. And the leaderboard's fallback for a
user with no display name was the local part of their email address, which is a small
information leak on a public board; it is now the word "Player."

**A double-click added an object twice.** Found during the human walkthrough, not by any
test. The add-object form does not disable its button while the action is in flight.
Logged as owed UI polish; the duplicate was removed by hand.

### What changed because of it

- `setGeneratedImage` exists for the imagegen stream: it takes no user, locks the game
  row the same way publish does, refuses a published game, and resets *every* object's
  confirmation on a new image, not only the ones it proposed positions for. Phase 2 must
  write through it; writing the columns directly would reopen the race.
- `/api/generate/*` is no longer public at the proxy. Browser polling carries a session;
  if imagegen ever needs an inbound webhook it will be whitelisted explicitly.
- The integration job is serialised (`concurrency` group) so two runs cannot truncate
  the same branch mid-test.
- Runtime validation at every action boundary: the `Normalized` brand is a compile-time
  fiction once JSON has carried a number over the wire, so coordinates, scale, marker
  shape, asset kind, and ids are all checked before they reach the database.

### Where this leaves us

`stream/platform` is green: typecheck, lint, 85 unit tests, 40 integration tests
against the Neon test branch, knip clean, zero duplication, production build succeeds.
The human walked the authoring flow end to end — sign in, create, upload background and
object, see publish refuse without an image, see it refuse with an unconfirmed object,
confirm, set a window, publish to `scheduled`, unpublish — without ever typing a
coordinate. The stored window matched the typed local time exactly, across a UTC midnight.
Phase 1 handoff is `docs/handoffs/phase-1.md`; the four things the other streams must
not break are the first section in it.

---

## Phase 2 — Imagegen stream: final-review fix wave

### What we set out to do

The eight Phase 2 tasks were done and reviewed; the review left eight findings, labelled
A to H, and this session applied all of them in one pass on `stream/imagegen`, one commit
per finding.

### What we decided and why

The one decision with alternatives was the retry rule in `src/lib/generation/run.ts`. The
loop already capped itself at 3 attempts, but a failure that added no new prompt adjustment
would send the exact same prompt again. We considered keeping the cap as the only stop and
relying on the adjustment table to always add something; we chose instead to stop the loop
the moment an attempt adds nothing, append "no new adjustment; not retrying" to that row's
reason, and keep the cap only for prompts that keep changing. The image-pipeline rule is
"a blind retry is not a recovery loop", and a resent identical prompt is a blind retry.

For the frame that differs everywhere from the background, `attemptOnce` now skips the
vision call: `validate.ts` exports `changedFraction`, and `attempt.ts` only calls
`backend.label` when it is at or below `MAX_CHANGED_FRACTION`. The validation result is the
same `background_altered` failure as before; the model call it saves was pure waste.

Inputs to the model are now bounded before they leave the server: `images.downscale`
brings the background to at most 1536 and each object image to at most 512 on the long
side. The diff still compares the generated image against the original background on one
grid, so every coordinate stays normalized against the generated image.

### What broke

Un-exporting `FAILURE_CLASSES` in `types.ts` so knip would stop reporting it made ESLint
report it instead: "assigned a value but only used as a type". The array only ever served
to derive the `FailureClass` union, so the array went and the union is written out
directly. knip and ESLint are both clean.

### What changed because of it

`diff.ts` shares one `forEachNeighbour` walk between `dilate` and `components`, which
took the jscpd clone count from 1 to 0. The add-object form in
`src/app/(master)/games/[id]/page.tsx` is keyed on the object count so it remounts after
each add and no longer keeps the previous upload key; `e2e/generate.spec.ts` lost its
"wait for the hidden key to change" workaround. The generation panel tells the master what
to do next per failure class: prompts for model failures, server configuration for
`config:`, logs for `error:` and `stale`. SPEC §5.3 gained the "background re-rendered"
row and the design doc records the stop rule and the input bounds.

Final numbers: 183 unit tests, coverage 99.04 % (baseline 98.03), 0 clones, knip clean,
7 integration tests on the Neon branch, 8 Playwright tests in paste mode. No Gemini call
was made.

---

## Phase 3 — Canvas stream

Branch `stream/canvas`, 25 commits, one session. Plan: `docs/plans/2026-09-13-phase-3-canvas.md`;
design: `docs/specs/2026-09-13-phase-3-canvas-design.md`; handoff: `docs/handoffs/phase-3.md`.

### What we set out to do

Build the part of the game a player actually touches: the canvas where markers are placed,
the page at `/g/<publicId>` that runs a play from Start to a scored result, and the
drag-to-confirm step on the master's edit page. Alongside it, pay the harness debt left
from Phase 0: a seed that puts a game in every lifecycle state, a Playwright suite, and a CI
job that runs it.

### What we decided and why

Phase 2 (image generation) and Phase 3 could have run in parallel. We chose Phase 3 first
because the canvas is what the master uses to confirm generated positions, so Phase 2's
output would have had nowhere to land; and the Playwright suite drives this surface, so
building it here closed two debts at once. The deterministic paste fallback moved to
Phase 2, whose directory it belongs to.

The canvas is an SVG overlay drawn in the generated image's own pixel space, stacked on
the `<img>` and scaled with it. The alternatives were positioned `<div>`s or an HTML
`<canvas>`. SVG won because a hit radius is a fraction of image *width* (the Phase 0
decision), which in pixel space is a plain circle — so what the master sees is exactly the
geometry `src/lib/scoring.ts` tests, and every marker is a real DOM element Playwright and
the keyboard can reach. All coordinate maths lives in `src/components/canvas/geometry.ts`,
pure and unit-tested; the component is an event-to-callback shell.

The Start screen cannot receive the image. `StartScreen`'s prop type has no image field,
and `page.tsx` builds its props from scratch rather than spreading the view. That turns
the "image before Start" rule from a discipline into a type error — and the E2E suite
checks it on the wire, not in the DOM.

Playwright signs in without a password or a Google login: Clerk's dev instance is
Google-only, so `@clerk/testing` mints a sign-in token through the Backend API and
signs in with it. Global setup finds the test user, runs the seed as that user, saves the
session, and the specs read the seeded ids from a JSON file. No dashboard changes.

The seed drives the Phase 1 core functions — `createGame`, `setGeneratedImage`,
`confirmObject`, `publishGame`, `startAttempt`, `submitAttempt` — with a shifted `now`,
rather than inserting rows. Every seeded game therefore passed the same validation and
locks the app uses. Fixtures are five PNGs generated once by a 60-line Node script, no
image library.

Execution used the same subagent-driven loop as Phase 1: eight tasks, a fresh implementer
and a fresh reviewer per task, one whole-branch review at the end. Cheap models did the
transcription tasks; the Playwright task and the final review ran on the strongest.

### What broke

The first `Timer` computed `Date.now()` inside `useSyncExternalStore`'s snapshot. React
requires that snapshot to be cached and change only when the store notifies; a live value
trips its consistency check and can re-render without limit. Unit tests could not see
it. The task reviewer caught it by reading; the fix keeps the number in a store object
created once per mount and updated only on the 100 ms tick.

A plain click on a marker fired `onMove` with unchanged coordinates. Harmless in play
mode, but in author mode a position write resets `confirmed`, so selecting an object
would have un-confirmed it. Caught as a "minor" in the canvas review; ruled load-bearing
and fixed at the source before the authoring task built on it.

Two quick gestures on the same object could overwrite each other: the second read the
first's not-yet-refreshed value from props. Fixed with a per-object cache of the last
sent position — and the fix's first version then left a ghost marker whenever a save
failed. The scoped re-review caught that; a failed send is now forgotten immediately.

The Playwright run exposed two layout bugs no reviewer had seen: the play screens
shrink-wrapped to 173 px until the image loaded, and the master page's background preview
reloaded on every render because each presigned URL is different. The harness had been
compensating with a `settled()` helper; the fix wave added `w-full`, reserved a box for
the preview, and dropped a redundant `router.refresh()` that rendered the page twice.

The whole-branch review found that the leak test could pass vacuously — nothing proved the
detector could fire at all — and that both error banners printed whatever text was in
`?error=`. Redirects now carry only an `ActionError` code, mapped to fixed copy in
`src/app/g/[publicId]/error-copy.ts`; the leak test runs its detector on both sides of
Start and requires a hit afterwards.

The fresh-context integration review at the phase boundary found the click guard had a
hole: a plain click on the *resize handle* still fired `onResize`, because the handle
drag started from the raw pointer position rather than the handle's centre. It also
found that holding an arrow key in author mode issued a locked transaction per key
repeat. Both were fixed in `src/components/canvas/marker-canvas.tsx` — drags that never
moved do nothing, handle drags carry their grab offset, and keyboard nudges commit once on
key-up — with one more E2E assertion for the handle click. The same review caught the
seed writing `published_at` in the future for scheduled games (the shifted `now` was
applied to every window, not only past ones) and the CI `e2e` job checking four of its
eight secrets; both one-line fixes.

The first CI run with real secrets failed the play spec twice, on assertions that had
passed locally against `next dev`. In a production build, Next streams a server action's
response and the browser discards the body the moment the router applies it, so
Playwright's `response.text()` returned nothing — first silently (the leak detector's
positive control "never fired"), then loudly (`No data found for resource`) on the submit
response. The fixes: the positive control now gates on the image *request URL*, which the
browser must send either way; and the submit response is intercepted with `page.route`,
fetched in full by the test, and then handed to the page. The suite now runs against
`next build && next start` locally with `CI=1` before it is pushed.

Two subagents skipped the manual browser check because they had no signed-in session. The
E2E suite, written next, became the first end-to-end run of the play surface — and passed
on its second attempt after three selector fixes (`role="alert"` also matched Next's route
announcer; "Confirm" also matched the "(unconfirmed)" chips).

### What changed because of it

Unit: 111 tests in 12 files, coverage 97.47 against a baseline of 96.77. E2E: 7 specs
green against the dev server, including the master redirect, the signed-out Start screen,
and the wire-level checks. jscpd 0, knip 0, lint 0. Three reviewer findings were parked
with rulings (see the handoff's known gaps); every other Important finding was fixed in a
review loop before the next task started.

### Where this leaves us

A second Google account can now open a seeded game, play it, and land on a leaderboard —
the spec's definition of done for gameplay. What is still missing is the image itself:
Phase 2 must produce `generated_image_key` and proposals for the master to drag. The canvas
is waiting for them.

---

## Autonomous loop evidence

### Loop 1 — Generation retry (product)

<!--
Fill from the generation_runs table once the pipeline runs. Include the prompt
adjustment at each step, not just the pass/fail, so the recovery is legible.
Query:
  select attempt, status, failure_reason, duration_ms from generation_runs
  where game_id = '<id>' order by attempt;
-->

### Loop 2 — Stop hook recovery (development)

First occurrence: 13 September 2026, Phase 1, Task 9 (master pages), fix round 1.

The orchestrating session had just told a subagent to fix a hydration bug in the window
inputs by setting state inside a `useEffect`. The subagent applied it and the
orchestrator tried to end its turn. The Stop hook ran `npm run verify` and refused:

```
Verification failed. Fix these, then finish.

--- lint ---
src/app/(master)/games/[id]/window-fields.tsx
  25:5  error  Calling setState synchronously within an effect can trigger
        cascading renders ... react-hooks/set-state-in-effect
> 25 |     setStart(startsAt ? toLocalInputValue(new Date(startsAt)) : "");
```

The failure went back into the loop as feedback. The orchestrator read it, recognised
its own instruction as the cause, and sent the subagent a replacement pattern
(`useSyncExternalStore` to detect the browser, a keyed remount so the inputs initialise
there — no effect, no `setState`). The hook blocked a second time while the subagent was
still mid-edit; the orchestrator waited for the commit rather than patching the file
itself, then re-ran lint: clean. Commit `41baa3d`. No human input between the block and
the green run.

What the loop demonstrates: the hook does not care who wrote the code or why. A prescribed
fix from the orchestrator was wrong for this React version, and the environment rejected
it before it could land. The same lint rule is now part of every implementer's `verify`
run, so the mistake cannot recur silently.

---

## Corrections absorbed into the system

Mirrors the table in SYSTEM.md §7. Each row started as a correction given twice.

| Date | Correction | Absorbed as |
| --- | --- | --- |
| pre-build | Hooks must not depend on tools that may be absent | Node rewrite; guard paths tested |
| 2026-09-13 | Tests must run on the same Node everywhere | `.tool-versions`, `.nvmrc`, `engines` in `package.json` |
| 2026-09-13 | Float boundary tests need binary-exact values | Comment in `scoring.test.ts`; squared-distance compare in `scoring.ts` |
| 2026-09-13 | Lockfile must resolve the way CI resolves it | Project `.npmrc` with `legacy-peer-deps=false` |
| 2026-09-13 | A crashed tool is not a passing check | `gate.sh` rejects non-numeric metrics |
| 2026-09-13 | The choke point must decide, not be told | `projectGame` takes `userId` + `now`, derives the rest |
| 2026-09-13 | Quality must not regress between sessions | CI ratchet: `quality-baseline.json` + `update-baseline` job |
| 2026-09-13 | Every mutation must lock what publish reads | Game-row `FOR UPDATE` in every draft-only mutation + race test |
| 2026-09-13 | Numbers over the wire are not `Normalized` | `isNormalized`/`isUuid`/`isOwnedKey` checks at every action boundary |
| 2026-09-13 | A skipped CI job is not a passing one | `integration` job publishes its own `status`; report renders `skipped` |
| 2026-09-13 | Reviewers see one task; some defects span tasks | Whole-branch review before merge (dedupe, key ownership, name leak) |
| 2026-09-13 | File-write hooks are bypassed by shell writes | *Open.* Guard should also match `Bash` and inspect the command for protected paths |
