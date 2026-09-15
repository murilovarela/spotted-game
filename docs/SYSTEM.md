# SYSTEM.md — Agentic engineering system

How this project was built. The product is in [SPEC.md](./SPEC.md); this document covers
the engineering system that produced it.

Built solo with Claude Code. Every agent, hook, and command described here exists in
`.claude/` and is runnable — nothing in this document is aspirational.

---

## 1. Design principles

Three rules governed every structural decision.

**A subagent must justify itself by context or tools, not by name.** If a unit of work
needs neither a different context window nor a different tool set, it is a prompt, not an
agent. There is deliberately no "builder" agent: the main session is the builder, and
routing implementation through a subagent would discard the context just accumulated.

**Guarantees are code; judgment is agents.** Anything that must be true every time is a
hook or a test. Anything requiring interpretation is an agent. The critical product
invariant — never leak object coordinates during an active game — is a test, not an
instruction, because an instruction can be forgotten and a test cannot.

**The system should absorb instructions.** Each time the same correction was given twice,
it moved into `CLAUDE.md`, a hook, or a test. Section 7 lists the corrections that were
absorbed and where they went.

---

## 2. Agent topology

```
                    ┌─────────────────────────┐
                    │   Main session          │
                    │   (orchestrator +       │
                    │    implementer)         │
                    └───────────┬─────────────┘
                                │ Task
          ┌──────────────┬──────┴──────┬──────────────────┐
          ▼              ▼             ▼                  ▼
      ┌────────┐  ┌─────────────┐ ┌──────────┐  ┌──────────────────┐
      │ scout  │  │image-pipeline│ │qa-playwright│ │integration-      │
      │        │  │             │ │          │  │reviewer          │
      │read-only│  │isolated ctx │ │browser   │  │fresh ctx         │
      └────────┘  └─────────────┘ └──────────┘  └──────────────────┘
```

| Agent | Why it is a separate context | Tools | Returns |
| --- | --- | --- | --- |
| `scout` | Searching the codebase pulls whole files into context to answer questions that need three lines. Isolation keeps the orchestrator's window spent on decisions, not on file contents. | Read, Grep, Glob | Findings and file:line references. Never file bodies. |
| `image-pipeline` | Carries Gemini API docs, prompt iterations, base64 payloads, and generation artifacts. None of this is relevant to the Next.js work and all of it is bulky. | Read, Edit, Write, Bash | A working pipeline module and a summary of prompt decisions. |
| `qa-playwright` | Needs a browser and the acceptance criteria; needs *not* to have the implementation rationale, so it tests behaviour rather than intent. | Bash, Read, Playwright MCP | Pass/fail per SPEC §8 criterion, with screenshots. |
| `integration-reviewer` | Its value is entirely that it has not seen the reasoning that produced the code. A reviewer sharing the builder's context has already accepted the builder's assumptions. | Read, Grep, Glob, Bash (read-only) | Ranked findings with severity. |

`qa-playwright` is checked against a fixed checklist rather than asked to freeform-compare
against the rules. SPEC §8 was written as discrete testable statements specifically so it
could serve as that checklist — the specification is durable agent context, not prose.

---

## 3. Context strategy

**Layered, with the cheapest layer loaded first.**

| Layer | Contents | Loaded |
| --- | --- | --- |
| `CLAUDE.md` | Invariants, conventions, commands, protected paths | Every session, automatically |
| `docs/SPEC.md` | Requirements, architecture, acceptance criteria | Referenced by path; read on demand |
| `.claude/agents/*.md` | Per-agent role and output contract | When that agent is spawned |
| `.claude/commands/*.md` | Repeatable procedures | On invocation |

`CLAUDE.md` is deliberately short. It holds only what is true across the whole repo and
would otherwise be repeated. Phase-specific detail lives in SPEC.md and is read when
relevant — loading the whole specification every session would be more context, not
better context.

**Fresh context at phase boundaries.** Each phase in SPEC §7 started with a cleared
context and a short handoff note (`docs/handoffs/phase-N.md`) written by the previous
phase: what was built, what contracts it exposes, what the next phase must not break.
Compaction was avoided in favour of these explicit handoffs, because a compaction summary
is whatever the model happened to retain, while a handoff note is what the engineer
decided mattered.

---

## 4. Orchestration and parallel work

### 4.1 The contract-first boundary

Phase 0 produced the Drizzle schema and `src/lib/types.ts` before any feature work began.
These two files are the entire shared surface between the three parallel streams. Every
other file each stream touches is disjoint by directory:

| Stream | Owns | Worktree |
| --- | --- | --- |
| **A — Platform** | `src/app/(auth)`, `src/app/api/games`, `src/lib/games`, `src/db` | `../spotted-platform` |
| **B — Image pipeline** | `src/lib/generation`, `src/app/api/generate` | `../spotted-imagegen` |
| **C — Play surface** | `src/components/canvas`, `src/app/g/[publicId]` | `../spotted-canvas` |

Three `git worktree` checkouts, three terminals, three Claude Code sessions. They cannot
collide because they cannot write to the same files, and the one file they all depend on
was frozen before they started.

### 4.2 Why these boundaries

The split follows the seams where *verification* differs, not where the code happens to
sit. Stream A is verified by integration tests against a real database. Stream B is
verified by a golden-set evaluation with a tolerance threshold, because its output is
non-deterministic. Stream C is verified by browser automation and screenshot comparison.
Three incompatible feedback loops is the actual argument for three streams — running them
in one session would mean one slow suite gating three fast ones.

### 4.3 What actually happened

The three-worktree layout in §4.1 was never exercised. `docs/evidence/timeline.md` shows
why: each stream's first commit follows the previous stream's merge commit by tens of
minutes to a couple of hours, with no interleaving between streams' commit windows. That
is one engineer running one orchestrating session per stream, in series, not three
concurrent sessions in three worktrees.

The commit timestamps are the evidence — `docs/evidence/timeline.md` reproduces them
directly from git (`git log --first-parent main --merges` for the merge order, then
`git log <merge>^1..<merge>^2` per merge for that stream's own commits) and states the
gaps. The reason three worktrees were not needed: the bottleneck was the review loop
(brainstorm → spec → plan → subagent-per-task review → whole-branch review → fix wave →
`integration-reviewer` → PR → CI), not parallel compute, and there was only one session
to run it.

### 4.4 Integration

Streams merged into `main` in the order they were actually run: A (platform), then C
(canvas), then B (imagegen) — not the A, then B, then C order the plan anticipated. Each
merge was gated on the full test suite passing and on a fresh-context `integration-reviewer`
pass; a whole-branch review preceded that gate on each stream, before its PR was opened.
Conflicts were confined to `package.json` by construction.

---

## 5. Harness

### 5.1 Layers

| Layer | Runs | Latency | Catches |
| --- | --- | --- | --- |
| `tsc --noEmit` on edited file | `PostToolUse` hook, every Edit/Write | ~2s | Type errors, at the moment of writing |
| Path guard | `PreToolUse` hook, every Edit/Write | instant | Writes to protected paths |
| Unit tests (Vitest) | `Stop` hook + CI | ~5s | Scoring, status derivation, validation predicate |
| Invariant tests | `Stop` hook + CI | ~8s | Coordinate leakage, authorization |
| Quality ratchet | CI, every PR | ~1min | Regression in coverage, lint, duplication, unused code, audit, security — §5.4 |
| E2E (Playwright) | CI + on demand | ~60s | Full authoring and play flows |
| Integration (Vitest + Neon branch) | CI | ~30s | Publish transaction, double-submit, timing, leaderboard visibility |
| Generation eval | On demand | ~3min | Pipeline quality against a golden set |

### 5.2 The Stop hook — the core of the system

`.claude/hooks/verify.sh` runs on the `Stop` event. If typecheck, lint, or tests fail, it
returns `{"decision": "block", "reason": "<failures>"}` on stdout. Claude Code then
prevents the turn from ending and feeds the failures back into the conversation.

The agent cannot finish while the build is broken. It must observe the failure, fix it, and
re-verify — and the re-verification fires the same hook again.

This is the mechanism that makes the autonomous loop structural rather than staged. It is
a direct application of a principle in the competition brief: rather than asking an agent
to continue when verification fails, the workflow returns the failure to the
implementation loop automatically.

Runaway protection: the hook reads `stop_hook_active` from its stdin JSON and additionally
tracks consecutive blocks in `.claude/.stop-count`. After three consecutive failures it
stops blocking and surfaces the problem to the human. An agent that cannot fix something in
three attempts is usually missing a decision only the engineer can make — that is a
handoff, not a failure.

### 5.3 Deterministic controls

| Control | Mechanism | Why not an instruction |
| --- | --- | --- |
| No secrets committed | `PreToolUse` guard on `.env*` + pre-commit hook | One leak is unrecoverable |
| Migrations not hand-edited | `PreToolUse` guard on `db/migrations/**` | Silent schema drift |
| No coordinate leakage | Invariant test over every endpoint | The product's correctness depends on it |
| Types always valid | `PostToolUse` typecheck | Cheaper at 2s than at 5min |
| Cannot finish broken | `Stop` hook | Section 5.2 |

Each of these began as something stated in a prompt. Each was moved into the environment
after being needed twice.

### 5.4 The quality ratchet

The Stop hook guards one session; the ratchet guards `main` across sessions. Ten gate jobs
run on every pull request and on every push to `main` (`.github/workflows/ci.yml`) — the
eight below in parallel, then `integration` (Neon branch) and `e2e` (Playwright) in
sequence, since both share one database:

| Job | Tool | Metric compared |
| --- | --- | --- |
| lint | ESLint | errors + warnings |
| typecheck | tsc | pass/fail |
| test | Vitest + v8 coverage | line coverage % |
| secrets | gitleaks | pass/fail |
| audit | npm audit | high + critical |
| duplication | jscpd | % duplicated lines |
| security | semgrep `p/security-audit` | ERROR findings |
| unused | knip | unused files, exports, types, deps |

Each numeric job reads its floor (or ceiling) from `quality-baseline.json` and fails if
the current value is worse. A `report` job posts one comment per PR with previous, current,
and delta per check, updated in place on every push. After a fully green run on `main`,
`update-baseline` rewrites the file with the measured values and commits it as
`github-actions[bot]` — so the baseline is never hand-set after the first commit, and
never drifts from what the gate actually measured.

Why a ratchet rather than fixed thresholds: a fixed threshold is a number someone picked
once and everyone argues with later. A ratchet only asks that things do not get worse
than they were, which is a rule nobody needs to negotiate. The cost is that a deliberate
drop (removing dead code that was covered, say) needs a human to edit the baseline in the
same PR — which is the right amount of friction for that decision.

Reproducibility guards that came out of the first CI runs: `.nvmrc` / `.tool-versions`
pin Node, `engines` enforces it, and a project `.npmrc` sets `legacy-peer-deps=false` so
a local install resolves exactly as `npm ci` does in CI.

---

## 6. Autonomous loop evidence

Two distinct loops, at different layers.

### 6.1 Product loop — image generation retry

This one is a shipped feature, not a development artifact. Full trace with timings,
failure reasons and the adjustment each failure added, in
[AI-DEV-LOG.md](./AI-DEV-LOG.md) under "Autonomous loop evidence → Loop 1", sourced from
the `generation_runs` rows of game `31defdcf-7314-4fdd-ba0c-c25c3cc8093b` on the
development database.

```
attempt 1  letterbox → generate → diff → vision
           FAIL: "Teddy bear" absent (diff merged it with the sneaker);
                 "Blue sneaker" 12.8× the requested scale
           adjust: restate the bear's placement, "clearly visible and larger";
                   restate the sneaker's 10 % width
attempt 2  generate → diff → vision
           FAIL: "Teddy bear" 159.6× the requested scale (recovered attempt 1's
                 two failures, but "larger" overshot)
           adjust: restate the bear's 3 % width
attempt 3  generate → diff → vision
           FAIL: both absent (diff merged bear, bag and sneaker) — cap reached,
                 game left untouched
```

No human input between attempts; the adjustment at each step is selected by the failure
taxonomy in SPEC §5.3. That run did not pass — its lesson (adjustments accumulate and
contradict; a merged diff region reads as "absent") drove the Phase 4 fixed-frame and
vision-fallback work. The same code path *with* a final pass is recorded in the same
dev-log section: the golden-set eval's `beach-towel` case went absent → adjusted → pass
on attempt 2 (0.99 / 0.98), and after the diff re-tune every golden case passed on
attempt 1.

### 6.2 Development loop — Stop hook recovery

[AI-DEV-LOG.md](./AI-DEV-LOG.md) "Autonomous loop evidence → Loop 2" — the hook's block
output and what followed. Phase 1, Task 9: the orchestrating session told a subagent to fix a
hydration bug in `src/app/(master)/games/[id]/window-fields.tsx` by setting state inside a
`useEffect`. The subagent applied it; the orchestrator tried to end its turn; the `Stop`
hook ran `npm run verify` and blocked on `react-hooks/set-state-in-effect`. The orchestrator
read the failure, recognised its own instruction as the cause, sent the subagent a
replacement pattern (`useSyncExternalStore` plus a keyed remount — no effect, no
`setState`), waited for the commit, and re-ran lint to green. Commit `41baa3d`. One human
prompt at the start; none between the block and the green run.

---

## 7. Instructions absorbed into the system

The running answer to *"am I telling the agent this again, or can I fix the system?"*

| Repeated correction | Became |
| --- | --- |
| "Run the tests before you finish" | `Stop` hook |
| "Don't put coordinates in the API response" | Invariant test |
| "Use normalized coordinates, not pixels" | Type-level `NormalizedPoint` brand + `CLAUDE.md` |
| "Don't edit generated migrations" | `PreToolUse` guard |
| "Check the status derivation, don't store it" | Unit test over all four states |
| "Return findings, not file contents" | `scout` agent output contract |
| "It works on my machine" (Node version) | `.nvmrc`, `.tool-versions`, `engines` |
| "npm ci fails in CI but not locally" | Project `.npmrc` pinning `legacy-peer-deps=false` |
| "Don't let coverage / lint / dead code slide" | CI quality ratchet, §5.4 |
| Parallel streams claimed, sequential streams delivered | Corrected in §4.3/§4.4 during Phase 4 |

---

## 8. Human decisions

Where judgment was applied rather than delegated. These were the actual forks.

1. **Pixel-diff before vision.** Vision alone was unreliable when the background contained
   objects similar to the hidden ones. Constraining detection to deterministically-computed
   changed regions fixed it. An architectural call, made after seeing the failure mode.
2. **Game master confirms every position.** Vision proposes; the human disposes. Accepting
   vision output as ground truth would have made scoring quietly wrong in a fraction of
   games, which is worse than being loudly wrong.
3. **Derived status over a scheduler.** Removed a cron job and a class of drift bugs.
4. **Rejecting a "builder" agent.** Evaluated and discarded — it added a context hop and no
   isolation benefit.
5. **Retry cap of three.** Chosen to bound cost and to force a handoff on genuinely
   ambiguous failures rather than burning quota against them.
6. **Deterministic paste fallback behind a flag.** Built before the AI blending path so
   that a generation-service failure could not produce an unplayable product.

---

## 9. Reproducing this

```bash
git clone <repo> && cd spotted
cp .env.example .env.local        # fill in
npm install
npm run db:migrate
npm run seed                      # demo games in all four lifecycle states
npm run dev
```

Then:

```bash
npm run verify                    # what the Stop hook runs
npm run test:e2e                  # Playwright
npm run eval:generation           # pipeline quality against the golden set
claude                            # hooks and agents load from .claude/
```

`.claude/` is committed. Opening it shows the same agents, hooks, and commands described
above, and `/hooks` inside Claude Code lists them as live configuration.
