# Report — Contract 0202 (macro upload store)

## Audit

**Accepted as specified, 2026-11-25 (planner). The contract had a defect, and the coder found it.**

I re-ran the checks myself:
- The migration SQL creates only `macro_uploads` and its index.
- The full suite passes at 1062, after 0204.
- `full-db` is IDENTICAL, so files survive the round trip through `store_upload` / `live_versions` byte for byte.

**The defect is the planner's.** `versions_to_evict` keeps the 5 newest rows, the live row and the pre-window version. It does **not** keep the window opener. With six uploads in one window, the opener is evicted, `T` falls back to the previous window's opener, and the slot reads as unlocked. I reproduced it with the pure functions: the evicted set was `{1}`, the opener, and `gate(T-25h, T+2h)` returned `Gate(True, True, None, None)`. That defeats the vandal limit the correction window exists for.

**The coder handled it right.** Implementing the contract and flagging the problem was better than editing criterion k to suit a fix. A criterion bent to suit a fix is exactly the clever pass that `planner-opus.md` warns about. Nothing is exposed, because no route calls the store yet.

**Fixed by contract 0205:**
- keep the opener;
- parse outside the global lock, then re-check the gate under it;
- store a fallback filename when the given one reduces to an empty string.

**Lesson for the planner:** a retention rule must preserve every row that a *derived state* reads. Here `T` is derived from the rows. When drafting, ask what each deletion rule destroys that some other rule reads.
