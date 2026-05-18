# Taphelu Close

Close work only after evidence exists.

1. Gather test, review, browser, or artifact evidence.
2. Call `dl_close` with verdict, evidence, testing strictness, and skipped-test rationale when relevant.
3. If close passes, recommend `dl_context_store action=compact` or `dl compact milestone`.
4. If close blocks, continue with the returned blocker.

Do not claim done without Taphelu closeout or equivalent evidence.
