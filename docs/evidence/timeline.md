# Evidence: the streams ran sequentially

`docs/SYSTEM.md` §4.1 describes a three-worktree parallel layout for streams A
(platform), B (imagegen), and C (canvas). That layout was never exercised. One engineer
ran one orchestrating session per stream, one after another, each going through the same
loop: brainstorm → spec → plan → subagent per task with review → whole-branch review →
fix wave → `integration-reviewer` → PR → CI → merge. This file is the git evidence for
both claims — sequential order and non-overlapping commit windows — plus the commands
used to produce it, so it can be reproduced from the repository alone.

## Commands

Merge commits on `main`, in order:

```bash
git log --first-parent main --merges --format='%h %ad %s' --date=iso
```

```
0352e6c 2026-09-14 16:36:12 -0300 Merge pull request #8 from murilovarela/phase-4/generation-fixed-frame
228b9d7 2026-09-14 13:57:57 -0300 Merge pull request #7 from murilovarela/stream/imagegen
33a32d2 2026-09-14 10:19:35 -0300 Merge pull request #6 from murilovarela/stream/canvas
5a644f3 2026-09-13 20:39:56 -0300 Merge pull request #5 from murilovarela/stream/platform
ea6f5cf 2026-09-13 17:49:45 -0300 Merge pull request #4 from murilovarela/phase-0/review-fixes
012099f 2026-09-13 17:26:24 -0300 Merge pull request #3 from murilovarela/docs/ci-dev-log
cec392a 2026-09-13 17:08:28 -0300 Merge pull request #1 from murilovarela/phase-0/contract
```

(PR #2, `ci/quality-gate`, merged inside the range covered by PR #1's history above —
it is a Phase 0 sub-branch, not one of the three streams, and is omitted from the table
below for that reason.)

For each stream merge, the commits unique to that branch — i.e. not already on `main` at
the time it branched — with first commit time, last commit time, and count:

```bash
git log <merge>^1..<merge>^2 --reverse --format='%h %ad %s' --date=iso
git log <merge>^1..<merge>^2 --format='%h' | wc -l
```

`<merge>^1..<merge>^2` (rather than `<merge>^2 --reverse`, which walks the branch's whole
ancestry including everything it forked from) isolates exactly the commits the PR added.

## Results

| PR | Branch | Merge commit | Merged at | First commit | Last commit | Commits |
| --- | --- | --- | --- | --- | --- | --- |
| #5 | `stream/platform` (A) | `5a644f3` | 2026-09-13 20:39:56 -0300 | 2026-09-13 18:03:51 -0300 | 2026-09-13 20:36:08 -0300 | 18 |
| #6 | `stream/canvas` (C) | `33a32d2` | 2026-09-14 10:19:35 -0300 | 2026-09-13 21:12:23 -0300 | 2026-09-14 10:14:21 -0300 | 25 |
| #7 | `stream/imagegen` (B) | `228b9d7` | 2026-09-14 13:57:57 -0300 | 2026-09-14 10:43:44 -0300 | 2026-09-14 13:54:07 -0300 | 26 |
| #8 | `phase-4/generation-fixed-frame` | `0352e6c` | 2026-09-14 16:36:12 -0300 | 2026-09-14 15:51:10 -0300 | 2026-09-14 16:26:30 -0300 | 7 |

## Reading the table

**Order.** Merges landed on `main` in the sequence #5 (platform, A) → #6 (canvas, C) →
#7 (imagegen, B) → #8 (Phase 4 fix). That is A, then C, then B — not the A, then B, then
C order §4.4 previously stated.

**No overlap.** Each stream's first commit comes after the previous stream's merge
commit, with a gap, not before it:

- platform's last commit (20:36:08) precedes canvas's first commit (21:12:23) by 36
  minutes.
- canvas's last commit (2026-09-14 10:14:21) precedes imagegen's first commit
  (10:43:44) by 29 minutes.
- imagegen's last commit (13:54:07) precedes PR #8's first commit (15:51:10) by
  just under two hours.

There is no interval in which two streams' commit timestamps interleave. Three
concurrent Claude Code sessions in three worktrees, as §4.1 describes, would show
overlapping windows; this history shows four disjoint windows in series. The streams
were run one at a time, each to a merged, green PR, before the next one started.

**Why sequential rather than parallel.** The constraint in this project was one engineer
running one orchestrating session — there was no second person or session to run a
second worktree concurrently with. The bottleneck the multi-stream split was designed
around (§4.2: three incompatible verification loops) is real, but it shows up as
faster context-switching between streams, not as wall-clock parallelism, when only one
session is doing the orchestrating.
