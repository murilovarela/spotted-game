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

## Phase 2 — Imagegen stream

Branch `stream/imagegen`, 25 commits, one session, after Phase 3. Plan:
`docs/plans/2026-09-14-phase-2-imagegen.md`; design:
`docs/specs/2026-09-14-phase-2-imagegen-design.md`; handoff: `docs/handoffs/phase-2.md`.

### What we set out to do

Build the part of the product that is genuinely uncertain: ask an image model to blend
the master's objects into their background, find where the objects ended up without
trusting the model to tell us, check the result against fixed rules, and — when it fails —
change the prompt in a specific way and try again, at most three times, with every attempt
written to the `generation_runs` table. SPEC §5.3 fixed that shape before any code; this
phase had to make it real and prove it with a golden-set evaluation.

### What we decided and why

The job runs inside Next's `after()` from a server action, with the page allowed 300
seconds. The alternatives were a queue vendor or driving the loop step by step from the
browser; the first buys durability we do not need, the second leaks the loop into HTTP.
A run that outlives the function is not left hanging: a row older than ten minutes reads
as `stale`, and the master is told to try again.

The paste fallback is a full stand-in, not a shortcut. `GENERATION_MODE=paste` composites
the objects deterministically and then runs the same diff → validate path the model
output goes through. CI never calls Gemini, yet the end-to-end test still uploads a
background and two objects, presses Generate, confirms the two circles and publishes —
SPEC §8's "upload to published without touching a coordinate". A validation failure in
paste mode is a pipeline bug, not a model quirk.

Pixel-diff before vision, as the spec insists. The diff is pure code over RGBA buffers:
threshold, dilate, connected components, merge, cap at twice the object count. Vision is
asked one question — which object is in each of these crops — and can never "find"
something that was already in the background.

Two things the spec did not know. First, on our synthetic seed fixtures Nano Banana
re-rendered the entire background, so the diff flagged the whole frame and the failure
read as `out_of_bounds` with an adjustment that could not help. We added a
`background_altered` class (changed regions over 60 % of the frame), its own "edit in
place" instruction, and an output aspect-ratio request; the golden set was made from
photographic scenes generated once with Gemini and committed. Second, the vision model id
in the plan did not exist and its predecessor is retired for new keys; the default is now
`gemini-3.6-flash`, overridable by env.

Execution reused the Phase 1/3 loop: eight tasks, fresh implementer and reviewer per task,
a whole-branch review, one fix wave. Two tasks — the Gemini adapter and the golden set —
went to the `image-pipeline` agent so the main session never saw a prompt iteration or a
base64 payload.

### What broke

An implementer added a `1e-9` epsilon to the overlap predicate to make a boundary test
pass. The reviewer caught it: the test's decimal literals did not round cleanly, and the
fix loosened SPEC's "≤ 20 %" for every caller. The epsilon went; the test uses dyadic
boxes (`0.125`, `0.3125`) whose intersection is exactly `0.2` in IEEE 754 — the same rule
the Phase 0 scoring tests follow.

My own plan code undercounted the failed streak when the latest run was stale
(`attempts: 1` regardless of what came before) — a reviewer caught it against the plan's
own contract.

The first real Gemini smoke found the MIME assumption: uploads may be JPEG or WebP, but
every input was declared `image/png`. Bytes are now sniffed by magic number and outputs
normalised to PNG.

The loop as first written would retry with an unchanged prompt when a failure repeated —
visible in the evidence table as `adjustment: null`, but still a paid, blind retry. The
whole-branch review called it against the image-pipeline rule ("a blind retry is not a
recovery loop"); the loop now stops the moment an attempt adds nothing new.

The first CI run of the pull request failed the paste-mode E2E with "failed after 2
attempts" while the same spec passed locally. The `generation_runs` rows on the CI branch
said why: one candidate region, both objects labelled into it, `overlap … by 100%` twice,
then the stop rule. Paste placement kept objects 2 % apart — exactly the diff's merge gap —
so on the seed that game id produced, the diff merged the two pasted objects into one
region. Locally a different game id had drawn a luckier layout. The placement gap is now
0.06 with a 200-seed test that asserts every pair stays clear of the merge gap; the diff
was right, the fixture was wrong.

The golden-set eval first scored 4/5: on the cluttered desk, one merged noise box
swallowed three objects. Re-tuning the diff (threshold 60, one dilation) took it to 5/5,
every case on the first attempt — with the SPEC thresholds untouched and the rationale
recorded on the constant.
### The final-review fix wave, in detail


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

#### What broke in the wave

Un-exporting `FAILURE_CLASSES` in `types.ts` so knip would stop reporting it made ESLint
report it instead: "assigned a value but only used as a type". The array only ever served
to derive the `FailureClass` union, so the array went and the union is written out
directly. knip and ESLint are both clean.

#### What the wave changed

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


### Where this leaves us

The whole product loop now exists: a master uploads, generates, drags, confirms and
publishes; a player finds. The autonomous loop is recorded in `generation_runs` (see
"Loop 1" below) and the golden set passes 5/5. What Phase 4 inherits is integration
polish: stable image URLs, the master-side leaderboard, deploy verification, and two
pipeline findings from the evidence run — adjustments for one object can contradict each
other, and a merged diff region still reads as "absent".

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

## Phase 4 — Generation: one frame, a game-aware prompt, a vision fallback

Branch `phase-4/generation-fixed-frame`, seven commits, one `image-pipeline` session.
Brief: `.superpowers/p4/brief-fixed-frame.md` (not committed); design changes recorded in
`docs/specs/2026-09-14-phase-2-imagegen-design.md` and SPEC §5.3.

### What we set out to do

A real game broke the loop in a way the golden set never showed. The master uploaded a
424×538 portrait photo of a house and asked for a woman "in a hidden place, small and
hard to find". The model answered a 928×1152 frame with every tree re-drawn, the diff
flagged 60–78 % of the frame on all five attempts, and every attempt failed as
`background_altered` — while the model had in fact put the woman exactly where asked, tiny,
in a doorway. Three things had gone wrong at once: the output shape followed the upload,
the prompt said nothing about what the picture was for, and a diff that cannot see a
small object had no second opinion.

### What we decided and why

One frame for every game. `gemini.compose` always asks for `4:3` at `1K` (the SDK's
`ImageConfig.imageSize` is a string with documented values `1K`, `2K`, `4K`; `1K` came
back as 1200×896). The prompt tells the model to extend a differently shaped background
to fill the frame, not crop or stretch it. The alternative — keep matching the upload's
shape — is what produced a different canvas geometry per game and a 3:4 request the model
answered with a re-synthesised scene. `closestAspectRatio` is gone with its only caller.

The diff compares against the background *letterboxed* into the output grid rather than
stretched to it: `images.letterboxTo` fits the upload on a neutral grey field and returns
a mask of the real pixels, and `diffRegions` takes that mask so the model's outpainted
bands can never count as a change. Both frames are Gaussian-blurred (sigma 1.5) first so
re-encoding grain and one-pixel shifts are not changes; the mask is inset by the blur's
reach so grey bleeding into the edge is not one either. The paste backend composites onto
the same letterboxed frame and places objects only on the real background, so CI's
deterministic path has the same shape as the model's.

The prompt now says what the image is for. One paragraph after the scene line explains
the hidden-object game — small, plausibly hidden, partly tucked behind scene elements, but
genuinely findable and covered at most about half — and the rules line asks for "no object
entirely hidden" instead of "every object fully visible". The `absent` and
`low_confidence` adjustments follow the same idea, and the default scale dropped from 12 %
to 6 % of the width. The old prompt was fighting the master: it asked for prominent
objects in a game whose point is that they are not.

A vision fallback, bounded. `GenerationBackend` gained an optional `locate`: one call
with the scene and the reference images, answering in Gemini's documented `box_2d`
localisation format on a 0–1000 grid, parsed by a pure `parseLocations`. `attemptOnce`
calls it only for the objects the diff left unresolved — all of them when the diff is
unusable — and the boxes join the candidates as `source: "vision"` through the same
validation. `background_altered` is no longer terminal by itself; it stands only when the
fallback found nothing. This keeps the load-bearing rule — vision labels regions it is
given, and the master still confirms by dragging — while giving the loop a way forward when
the diff is structurally blind. The alternative, raising the 60 % threshold, would have
passed the user's frames while still saying nothing about where the woman was.

### What broke

`parseLocations` first computed the box as `(xmax − xmin)` after dividing by 1000, and the
unit test showed `0.39999999999999997` for a 400-wide box; it now clamps on the integer
grid and divides once. The first `paste.locate` needed a game id the `LocateInput` does
not carry, so the paste backend's placements are keyed by object id instead. Factoring
`label` and `locate` into one `visionJson` helper was forced by jscpd reporting a 12-line
clone. Exporting `ObjectInput` for the new types made knip report it unused, so it stays
module-private.

The E2E could not run the usual way: a `gemini`-mode dev server from the user's own
session already owned port 3000, Playwright would have reused it and spent real quota,
and Next 16 refuses a second dev server in the same directory. The suite ran against a
production build on port 3001 with `GENERATION_MODE=paste` from a scratch config; the
user's server was left running.

### What changed because of it

The user's case, re-run through `attemptOnce` with the real backend: attempt 1 returned
1200×896; the diff still flagged 45 % of the frame (one region over the whole letterboxed
content — the model re-composed the scene while extending it), vision labelled that
region as none of the objects, so `locate` ran for the woman and returned a 2.3 % × 4.9 %
box by the pool, half behind a hedge, at confidence 0.98; validation passed. One compose,
two vision calls, no retry. The golden set is 5/5 on attempt 1 with the new prompt; on
`kitchen-counter` the diff found two regions for three objects and `locate` resolved the
third at 0.95. Diff cover on the golden frames is 0.7–10 %.

Numbers: 202 unit tests (+18), line coverage 99.45 % (baseline 99.41), 0 clones, knip
clean, 7 integration tests, 8 Playwright tests in paste mode. API spend for the session:
6 compose and 8 vision calls against a budget of 20 and 40.

### Addendum — the two problems the first run exposed

The first real run left two things open: the model did not keep the photographed area
where the diff's letterbox expected it (one region over 45 % of the frame, labelled as
none of the objects), and the 60 % threshold was measured against the whole frame, so a
portrait upload could be almost entirely re-rendered and still read as "usable".
Commit `9081b99` closed both. The model now receives the background *already*
letterboxed into the 4:3 frame — the same canvas the diff compares against — and, only
when there are bands, a prompt line saying the flat grey bands are empty space to extend
into while the photographed area stays exactly where it is. `changedFraction` divides by
the mask's share of the frame, so cover is judged over the real content.

The second real run of the user's case: 1200×896, content fraction 0.567, masked diff
cover **0.000** — the photographed area stayed put and only the bands were filled. The
diff found no candidate; `locate` placed the woman in an upstairs window at 2 % of the
frame's width, confidence 0.98; validation passed on attempt 1. A probe on the same
frames explained the zero: at the 512-pixel diff grid she is about 10×15 pixels and
produces 38 changed pixels unblurred, 3 blurred, under the 98-pixel minimum area. The
diff was not wrong; the object is below its resolution.

The branch review then fixed the record-keeping around it (`run.ts` composed the queued
row's prompt before the background's shape was known, so a thrown attempt on a portrait
upload would have stored a prompt that was never sent — the row is now overwritten with
the real prompt right after the images load, with an integration test on a 300×400
background), made the frame geometry one pure function (`frameGeometry`, bands under 1 %
of a side do not earn the prompt line), and guarded a zero content fraction so the diff
reads as unusable rather than `NaN`. Seven commits, 211 unit tests, coverage 99.46 %.

### Where this leaves us

A non-4:3 upload now produces a 4:3 game whose diff compares like with like and is honest
about what it sees. The real open item is the diff's floor: objects around 6 % of the
width and larger are found by the diff; below that — the hidden-object case the master
actually asked for — the vision fallback is the finder and the master's drag-to-confirm
(§5.4) is the guard. Raising the diff grid or lowering its minimum area would move that
floor, at the cost of re-tuning against the foliage noise the golden set showed.

---

## Phase 4 — Deploy: the site goes live

Branch `phase-4/deploy`, ten commits including this entry. Design in
`docs/specs/2026-09-14-phase-4-deploy-design.md`, plan in
`docs/plans/2026-09-14-phase-4-deploy.md`, runbook in `docs/DEPLOY.md`.

### What we set out to do

Put the game on the internet at `https://spotted.murilovarela.dev`, with only the code
changes a deployment actually needs. The owner drew the line at three prerequisites and
said no to everything else on the wish list (leaderboard on the master page, upload size
caps, the remaining Phase 3 gaps): image URLs that stop changing every render, a per-user
cap on generation so one account cannot spend the Gemini budget, and finalization for
generation rows that a killed serverless function leaves marked "running" forever.

### What we decided and why

Deploy from the CLI, not from a Git integration. The owner linked the Vercel project and
set every secret in the dashboard; the agent only ever ran `npx vercel --prod`. Migrations
and the seed against production are the owner's to run — the agent never holds a
production connection string. Clerk stays on its development instance, because the
alternative (a production instance with a custom domain and Google OAuth credentials) was
a day of console work for no change to the game.

Presigned URLs became stable by signing them with an hour-bucketed date
(`presignGet(key, now)` in `src/lib/storage.ts`, expiry two hours). The alternative was
to cache the URLs per request; the bucket approach needs no state, and the integration
reviewer confirmed on the live site that Neon storage accepts a signing date 31 minutes
in the past. Along the way the first implementation had a one-line bug that the task
reviewer caught: `unique.map(presignGet)` passes the array index as the second argument,
so every URL would have been signed with the date `0`, `1`, `2`.

The generation guard grew a lock. `startGeneration` already locked the game row; the task
reviewer pointed out that two of the same master's games could each pass the
"live elsewhere" check at the same moment and both start, so the transaction now locks the
master's `users` row first (`af22944`). Lock order `users → games` was checked against every
other transaction for cycles; there are none. The daily cap counts every attempt row —
retries included — in a rolling 24 hours, default 20, `GENERATION_DAILY_CAP` to change it.

### What broke

The runbook was written before the facts were checked. It told the owner to add the
site's origin to the bucket's CORS rules and to set `NEXT_PUBLIC_APP_URL`; the bucket
already allowed `*`, and nothing in the code read that variable. The owner said "don't
think there's cors allowed origins for the free plan", which was the prompt to look.
Both were removed (`c8ab20d`), and the reviewer later found the same disease in
`docs/SYSTEM.md` §6: it cited a dev-log section and an evidence file that had never
existed, with a coffee-mug trace that was invented. That section now carries the real
Teddy bear / Blue sneaker rows from `generation_runs` (`ed00987`).

The Vercel project defaulted to Node 24 while everything local and in CI is Node 22;
`engines.node: "22.x"` in `package.json` pinned the build. The first curl smoke of
`/games` returned 404 rather than a redirect — Clerk's development instance rewrites
requests without its dev-browser cookie — which is not a bug but cost ten minutes.

The integration reviewer's other HIGH finding was procedural: the runbook seeded as the
owner *before* running Playwright, but Playwright's global setup reseeds under the e2e
user and its authoring spec publishes the seeded draft. On a production database that
shares the development branch — which it does, for now — every local `npm run test:e2e`
rewrites the demo games. The steps were swapped and the hazard written down.

### What changed because of it

Production serves the branch's code; the E2E suite ran against it in remote mode
(`PLAYWRIGHT_BASE_URL`, 7 of 7, generation spec skipped) and the reviewer verified from
outside that an active game's payload carries no coordinates, that draft and scheduled
games 404, and that the CORS preflight from the production origin succeeds. Security
review found nothing; all six invariants hold with a `file:line` per path. Left with the
owner: reseed as themselves, one play from a second Google account, one real generation on
Vercel — the first time `sharp` runs there.

### Where this leaves us

The product is live and every functional phase is merged. The database still shares the
development branch, which is the first thing to change before real players arrive. The
next phase is the one the owner has been waiting to say out loud: the UI is unstyled and
the flows are bare, and shadcn/ui is the chosen way to fix that.

---

## Autonomous loop evidence

### Loop 1 — Generation retry (product)

Recorded 14 September 2026 from a real run of `runGeneration` (Gemini backend) against
the development database, game `31defdcf-7314-4fdd-ba0c-c25c3cc8093b` — the golden
beach-towel scene with a Teddy bear asked to be 3 % of the image width and a Blue sneaker
at 10 %. No human input between the steps; every row was written by the loop.

| attempt | status | duration | failure_reason | adjustment added for the next prompt |
| --- | --- | --- | --- | --- |
| 1 | failed | 25.1 s | `absent: Teddy bear — no changed region was labelled as this object`; `scale: Blue sneaker — box area is 12.8× the requested scale` | "Place the Teddy bear exactly as described (sitting on the towel) and make it clearly visible and larger than before." / "The Blue sneaker should be roughly 10% of the image width — about the size of a prominent element of the scene." |
| 2 | failed | 24.6 s | `scale: Teddy bear — box area is 159.6× the requested scale` | "The Teddy bear should be roughly 3% of the image width — about the size of a prominent element of the scene." |
| 3 | failed | 30.3 s | `absent: Teddy bear …`; `absent: Blue sneaker …` | "Place the Blue sneaker exactly as described (on the sand beside the towel) and make it clearly visible and larger than before." — cap reached, game left untouched |

What the frames show: attempt 1 drew the bear small on the towel, but the diff merged it
with the sneaker and the re-lit towel into one region, so vision named the region "sneaker"
and the bear read as absent. Attempt 2 recovered both attempt-1 failures — the bear was
labelled at 0.99 and the sneaker landed inside its 10 % tolerance — but "larger than
before" had produced a bear 45 % of the frame wide, 159× its 3 % target. Attempt 3, now
carrying both "larger" and "3 %", drew the bear small again but against the beach bag; the
diff merged bear, bag and sneaker, vision returned null at 0.90, and both objects read as
absent. Three attempts in 82 seconds, each with a specific reason and a specific change.

The same loop *with* a final pass was recorded by the golden-set eval on 14 September
(run 1, case `beach-towel`, via the identical `attemptOnce` code path): attempt 1 `absent`
for both objects → the two "clearly visible and larger" adjustments → attempt 2 passed
with both objects at 0.99 and 0.98. After the diff re-tune every golden case passed on
the first attempt (5/5), and two further real games on the dev database
(`e358b279-b6a1-4a00-b439-b0bdd552345e`, `fb04460d-c14d-4006-bf9f-39bc64f0a759`) passed on
attempt 1 as well, with every label at 0.99.

What the run teaches: the loop mechanics are right (a row before every call, a reason on
every failure, a changed prompt on every retry, a hard cap, the game untouched on
failure), and two of the adjustments are not. Adjustments for one object accumulate and
can contradict ("larger" and "3 %" both stayed in the prompt); and a merged diff region is
reported as "absent" when the object is present but touching a neighbour. Both go to
Phase 4 as pipeline improvements with a recorded case to test against.

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
| 2026-09-14 | Runbook claims must be checked against the environment before being written | *Open.* The integration-reviewer brief now asks for a docs-vs-deployment pass; no automated check |
