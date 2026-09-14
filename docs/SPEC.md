# SPEC.md — Spotted

## 1. Objective

A web app that lets a game master compose a hidden-object puzzle from a background
image and up to five object images, using generative AI to blend the objects into the
scene, and then run it as a timed competition with a leaderboard.

The product replaces a manual Slack ritual at Howdy, where hidden-object images are
posted to `#challenge` and players reply "FOUND" with no verification, no timing, and
no ranking.

## 2. Users and roles

| Role | Capability |
| --- | --- |
| **Game Master** | Creates games, uploads assets, verifies object positions, schedules the window |
| **Player** | Opens a game link, places markers, submits, appears on the leaderboard |

Authorization is per-game: the creating user is that game's master. There is no global
admin role and no organization model. Any authenticated user may create a game.

## 3. Core requirements

### 3.1 Game authoring

1. The game master uploads one background image and one to five object images.
2. Each object carries a short prompt describing how it should be placed
   ("tucked behind the yellow tunnel, partially occluded").
3. The game carries a general prompt describing global style and difficulty.
4. The system generates a composite image with the objects blended into the scene.
5. The system proposes a position and radius for each object.
6. The game master reviews the proposed positions on the generated image, adjusts them
   by dragging, and confirms.
7. The game master sets `starts_at` and `ends_at`, then publishes.

### 3.2 Lifecycle

Status is **derived on read** from the current time and the publication flag. It is never
stored as a mutable column and never advanced by a scheduled job.

| Status | Condition | Image visible | Answers visible |
| --- | --- | --- | --- |
| `draft` | not published | master only | master only |
| `scheduled` | published, `now < starts_at` | no | no |
| `active` | `starts_at ≤ now < ends_at` | yes | no |
| `finished` | `now ≥ ends_at` | yes | yes |

### 3.3 Gameplay

1. A player opens the game at `/g/{publicId}` where `publicId` is a 21-character
   nanoid. The route returns 404 for any game not yet `active`, except to its master.
2. The player presses **Start**. The server records `started_at` and returns the image.
   The timer is anchored to the server's timestamp, not the client's.
3. The player places markers by clicking. Markers can be dragged to reposition, and
   dragged onto a trash target to delete.
4. The player must place exactly N markers, where N is the object count, before
   submitting. The thumbnails of all N objects are displayed alongside the image, so the
   player knows what they are looking for.
5. Markers are not labelled. The player places N markers anywhere; assignment to objects
   is computed at scoring time. They do not declare which marker is which object.
6. **Each player gets one submission per game.** Submit is guarded by a confirmation step
   that states this plainly. After submitting, the player sees their result and the
   leaderboard, and cannot play again.
7. The result reports how many objects were found and the elapsed time. It does not
   reveal where the misses were.
8. After `ends_at`, the game page shows the image annotated with the true positions and
   the final leaderboard.

**Abandonment.** The timer runs server-side from `started_at` and does not pause. A player
who presses Start and closes the tab keeps accruing time, and an unsubmitted attempt never
reaches the leaderboard. The Start screen must say this before the player commits.

### 3.4 Scoring

- A marker is a hit if its centre falls within the object's confirmed radius.
- Marker-to-object assignment is a greedy nearest-match; each object is consumed once,
  so two markers on one object cannot both score.
- **Ranking is by objects found descending, then elapsed time ascending.** Every player
  who submits appears on the leaderboard.
- One entry per user per game, enforced by a unique constraint on `(gameId, userId)` in
  `attempts`. A second submission is rejected at the database level, not only in the UI.

Ranking on found-then-time rather than all-or-nothing is a consequence of the one-shot
rule. With a single attempt and five objects, perfect scores are rare, and an
all-or-nothing board would usually be empty — which reads as a broken product rather than
a hard game. Partial scores keep the board populated while still ranking perfection first.

**Leaderboard visibility.** A player sees the leaderboard once they have submitted. It is
hidden beforehand, so it cannot hint at how achievable a fast time is. It exposes names,
scores, and times only — never coordinates.

## 4. Constraints

- **Solo build.** Every workstream must be completable and verifiable without a second
  engineer. This drives the harness-first ordering in §7.
- **No coordinates on the wire during play.** Scoring is server-side only. A player who
  opens devtools must learn nothing.
- **All timestamps UTC**, converted for display only.
- **Vercel serverless limits.** Image generation exceeds the request timeout, so
  generation runs as a background job with polling, not inside a request handler.
- **Nano Banana output is not dimensionally guaranteed.** The generated image — not the
  uploaded background — is canonical. All coordinates are normalized `[0,1]` against it.
- **No secrets in source control.** Enforced by a pre-commit hook, not by convention.

## 5. Architecture

### 5.1 Stack

| Layer | Choice | Rationale |
| --- | --- | --- |
| Framework | Next.js (App Router) | Server actions keep scoring server-side by default |
| Hosting | Vercel | Zero-config preview deploys give the agent a verifiable artifact |
| Auth | Clerk (free tier), Google only | Removes session handling from scope entirely |
| Database | Neon Postgres + Drizzle | Typed schema is the shared contract between workstreams |
| Blob storage | Neon Object Storage (S3-compatible) | Same vendor as the database; buckets branch with the project; signed URLs for unpublished assets |
| Generation | Nano Banana (Gemini image) | Strongest subject-consistency when compositing a supplied object |
| Detection | Gemini vision, constrained by pixel diff | See §5.3 |

### 5.2 Data model

```
users            — mirrored from Clerk on first sign-in
games            — publicId, masterId, prompts, starts_at, ends_at, published_at,
                   backgroundUrl, generatedImageUrl, imageWidth, imageHeight
objects          — gameId, label, prompt, sourceImageUrl, x, y, radius, confirmed
attempts         — gameId, userId, started_at, submitted_at, elapsed_ms, found_count
                   UNIQUE (gameId, userId) — one attempt per player, enforced in the DB
markers          — attemptId, x, y, matchedObjectId
generation_runs  — gameId, attempt number, status, prompt used, vision response,
                   failure reason, duration
```

`objects.x`, `objects.y`, `objects.radius` and `markers.x`, `markers.y` are normalized
floats in `[0,1]`, relative to the generated image.

`generation_runs` is not incidental logging. It is the durable record of the autonomous
loop and the primary evidence artifact for the submission.

### 5.3 Generation pipeline

```
compose prompt
      ↓
Nano Banana  ──────────────→  generated image
      ↓
pixel-diff vs. background  →  candidate changed regions   (deterministic)
      ↓
Gemini vision, given candidates + object crops
      ↓
label each candidate → {objectId, x, y, radius, confidence}
      ↓
   VALIDATE
      ↓
  pass → persist, await game master
  fail → adjust prompt, regenerate  (max 3 attempts, then surface to master)
```

Pixel-diffing before vision is the load-bearing decision. It reduces detection from an
open-ended search over the whole frame to a labelling problem over a handful of known
candidate regions — which is both more reliable and cheaper. It also catches the case
where the model silently declined to place an object: no diff region, no candidate.
When the diff is unusable (the model re-rendered the frame) or finds nothing for an
object, the vision model is asked to locate that object directly; those boxes go through
the same validation and the master still confirms by dragging (§5.4).

**Validation predicate** — all must hold:

- every object has exactly one matched candidate region
- confidence ≥ threshold
- the box lies fully within the frame, outside the outer 3% margin
- no two boxes overlap by more than 20%
- box area is within an order of magnitude of the requested scale

**Failure handling** — each failure maps to a specific prompt adjustment:

| Failure | Adjustment |
| --- | --- |
| Background re-rendered (changed regions cover > 60% of the frame) | Instruct the model to edit the supplied image in place and change nothing but the added objects |
| Object absent from diff | Restate that object's placement more explicitly, raise its prominence |
| Low confidence | Reduce occlusion in the object's prompt |
| Overlapping boxes | Add explicit separation instruction |
| Out of bounds | Constrain to the central region |
| Implausible scale | Pin scale relative to a named background element |

After three failed attempts the game stays in `draft` with the failures surfaced to the
master, who can edit prompts and retry. Blind retry is capped deliberately: the loop
must terminate, and an unbounded loop burns quota without converging.

### 5.4 Verification is advisory; the master is authoritative

Vision output is a *proposal*. The confirmed ground truth is whatever the game master
leaves on screen after dragging. `objects.confirmed` gates publication: a game with any
unconfirmed object cannot be published, enforced by a check in the publish transaction.

This is the central human-judgment boundary in the system. The agent does the work that
is tedious and approximately correct; the human does the work that must be exactly
correct, and does it in seconds by dragging rather than by typing coordinates.

## 6. Key technical decisions

1. **Derived status over stored status.** Eliminates a cron job, a failure mode, and a
   class of drift bugs. Cost: status must be computed in every read path.
2. **Normalized coordinates.** The image renders at different sizes across devices;
   normalizing at the boundary means the scoring function is resolution-agnostic and
   directly unit-testable.
3. **One `MarkerCanvas`, two modes.** Authoring and playing are the same interaction with
   different permissions and payloads. Building it once halves the hardest UI work and
   guarantees the master sees exactly the geometry players will be scored against.
4. **Generation as a job, not a request.** Required by serverless timeouts, but also lets
   the retry loop run to completion without a client connection held open.
5. **Deterministic diff before probabilistic vision.** Detailed in §5.3.
6. **Greedy nearest-match scoring.** Optimal assignment (Hungarian) is unnecessary at
   N ≤ 5 and harder to reason about; greedy with a consumed-object set is sufficient and
   trivially testable.

## 7. Build order

Harness first. Streams B and C cannot iterate autonomously against nothing.

| Phase | Content |
| --- | --- |
| 0 | Schema, shared types, CI, hooks, seed fixtures, Playwright skeleton |
| 1 | Auth, game CRUD, derived status, routing (**A**) |
| 2 | Generation pipeline and retry loop (**B**) — isolated context |
| 3 | `MarkerCanvas`, play surface, leaderboard (**C**) |
| 4 | Integration, review pass, deploy verification |

Phases 1–3 share only the Phase 0 contract and are the intended parallelization
boundary. Stream B is context-isolated: it is image-heavy, prompt-heavy, and would
otherwise flood the orchestrator's context with generation artifacts.

A deterministic paste path (compositing without AI blending) ships behind a flag in
Phase 0 as a fallback. If Nano Banana proves unreliable, the product still plays.

## 8. Acceptance criteria

**Authoring**
- A master can go from upload to published game without touching a coordinate value.
- A game with an unconfirmed object cannot be published.
- A generation failure surfaces a specific, actionable reason.

**Lifecycle**
- A `scheduled` game returns 404 to a non-master and renders for its master.
- An `active` game serves the image and no coordinates.
- A `finished` game renders annotated positions and the leaderboard.

**Gameplay**
- Markers can be added, dragged, and deleted; submit is blocked below N markers.
- Object thumbnails are visible throughout play.
- Submit requires confirmation and cannot be repeated; a second attempt is rejected by the
  database, not only hidden in the UI.
- Elapsed time is computed server-side and is immune to client clock manipulation.
- The leaderboard ranks by objects found, then time; every submitter appears.
- The leaderboard is hidden until the player has submitted.
- A result reports the number found, never the location of a miss.
- An abandoned run accrues time and never reaches the leaderboard.

**Harness**
- Typecheck, lint, unit, and E2E all run in CI on every push.
- Scoring is covered by unit tests including boundary and double-marker cases.
- At least one Playwright test drives a full authored game to a scored submission.
- A recorded loop in `generation_runs` shows failure, adjustment, and recovery with no
  human input between the steps.

## 9. Definition of done

1. Deployed on Vercel, reachable, and playable end-to-end by a second Google account.
2. A seeded demo game exists in every lifecycle state for the video.
3. CI green on `main`.
4. `SPEC.md`, `SYSTEM.md`, `AI-DEV-LOG.md`, and `README.md` present and accurate.
5. At least one complete autonomous loop evidenced from `generation_runs`.
6. No secret has ever been committed; `.env.example` documents every variable.

## 10. Explicitly out of scope

Teams and orgs. Slack integration. Mobile-native clients. Hints. Retries. Pausing a run.
Multi-round tournaments. Editing a game after it goes active. Image moderation.
Internationalization. Accessibility beyond keyboard-reachable controls.

## 11. Resolved design decisions

Settled before implementation began. Recorded here because each one has a schema or
scoring consequence, and reversing one later is not a cosmetic change.

| Decision | Choice | Consequence |
| --- | --- | --- |
| Are objects revealed? | All N thumbnails shown during play | Game is "find these five", not "search everything". Object images must render alongside the canvas. |
| Submissions per player | One | Unique constraint on `(gameId, userId)`. Confirmation step required before submit. |
| Ranking | Objects found, then time | Every submitter appears. Prevents an empty board under one-shot rules. |
| Leaderboard visibility | After the player's own submission | Cannot hint at achievable times beforehand. |
| Marker labelling | Not required | Greedy nearest-match at scoring time; simpler UI, and order carries no information. |
| Master plays own game | No | Excluded from the leaderboard; they have seen the answers. |
| Abandoned runs | Timer continues, no entry | No pause state to model. Start screen must warn. |
