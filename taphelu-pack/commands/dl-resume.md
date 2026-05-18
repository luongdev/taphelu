# Taphelu Resume

Resume from compact Taphelu context.

1. Call `dl_start` with the resumed goal if known.
2. Call `dl_context` with the current task query.
3. Use `dl_recall` only for relevant L1/L2 memory.
4. Use `dl_context_store action=search` before loading large artifacts.
5. Check `dl_review_status` if the task looks medium-plus or larger.

Keep the resumed prompt small and source-traceable.
