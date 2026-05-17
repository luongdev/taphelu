---
name: taphelu-verify
description: Use when validating Taphelu work, recording review gates, or closing a session.
---

# Taphelu Verify

Define done before closing work.

Required evidence can include:

- Updated artifacts.
- Tests or browser checks.
- QA task testability review.
- Required evidence and skipped-test rationale.
- Review evidence when review triggers exist.
- Cross-AI review status when policy triggers exist.
- Explicit blockers when work cannot close.

Use `dl verify` for human-readable verification reports.

Use project `testing.strictness` to decide evidence depth: `low` favors smoke/artifact checks, `medium` covers main flows and important contracts, `deep` expects unit or integration coverage for changed logic.

Use `dl_close` to close agent work; it must block without passing verification evidence.

Cross-AI review is permission-gated. Do not invoke another runtime silently; record skipped/requested/completed/blocked status in closeout.
