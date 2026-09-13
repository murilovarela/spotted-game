---
description: Close out the current phase and write a handoff note for the next one
---

Close out this phase.

1. Run `npm run verify` and `npm run test:e2e`. Do not proceed if either fails.
2. Spawn `integration-reviewer` on the work completed in this phase. Address anything
   CRITICAL or HIGH before continuing.
3. Write `docs/handoffs/phase-<N>.md` containing:
   - **Built** — what now exists, in three or four bullets
   - **Contracts exposed** — types, endpoints, and tables other streams may rely on
   - **Do not break** — constraints the next phase must respect
   - **Known gaps** — what was deliberately left undone, and why
4. Append the phase's significant decisions, failures, and recoveries to
   `docs/AI-DEV-LOG.md`. Include what did not work, not only what did — a log of
   successes is not evidence of a process.
5. Commit.

Keep the handoff under 400 words. It is loaded into a fresh context; it should carry
decisions, not narration.
