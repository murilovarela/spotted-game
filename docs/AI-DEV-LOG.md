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

### Where this leaves us

`npm run verify` is green: type check, lint, and 39 unit tests across scoring, types, and
invariants. The contract files — `src/db/schema.ts` and `src/lib/types.ts` — are frozen
for the three streams. Two things were deliberately left to Stream A: the database client
(the HTTP driver cannot run the transaction that publication requires) and the function
that derives a game's status from its timestamps.

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

<!--
Paste a transcript excerpt: implementation finishes → hook blocks on failing tests →
agent reads failure, fixes, re-verifies → green. No human prompt in the middle.
Capture this the first time it happens; it is hard to reconstruct later.
-->

---

## Corrections absorbed into the system

Mirrors the table in SYSTEM.md §7. Each row started as a correction given twice.

| Date | Correction | Absorbed as |
| --- | --- | --- |
| pre-build | Hooks must not depend on tools that may be absent | Node rewrite; guard paths tested |
| 2026-09-13 | Tests must run on the same Node everywhere | `.tool-versions`, `.nvmrc`, `engines` in `package.json` |
| 2026-09-13 | Float boundary tests need binary-exact values | Comment in `scoring.test.ts`; squared-distance compare in `scoring.ts` |
| 2026-09-13 | File-write hooks are bypassed by shell writes | *Open.* Guard should also match `Bash` and inspect the command for protected paths |
