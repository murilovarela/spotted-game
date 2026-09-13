---
description: Verify the six product invariants hold across the codebase
---

Verify each invariant in `CLAUDE.md` against the current code. For each one, report
`HOLDS`, `VIOLATED`, or `UNVERIFIED`, with a `file:line` reference.

Use `scout` to investigate rather than reading files into this context directly.

Pay particular attention to invariant 1. Check every server action and route handler that
can return game data, and confirm each filters coordinates by derived status. A single
unfiltered path defeats the whole scheme, so enumerate them exhaustively rather than
spot-checking.

If any invariant is `VIOLATED`, stop and report before fixing. If any is `UNVERIFIED`,
that means no test covers it — say which test is missing.
