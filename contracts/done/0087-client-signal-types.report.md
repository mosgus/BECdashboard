# Report — Contract 0087 (Client signal types)

**Verdict: accepted.** Every grep empty as required, `TSC OK`, 63 frontend, 493 backend.

## The build hash is the proof

```
0086:  dist/assets/index-DDEeCnHx.js   364.50 kB │ gzip: 108.18 kB
0087:  dist/assets/index-DDEeCnHx.js   364.50 kB │ gzip: 108.18 kB
```

**Byte-identical output, same content hash.** TypeScript types are erased at compile time, so a
genuinely type-only change emits identical JavaScript. That is stronger evidence than the size
matching — a size that happened to match could still be different code; an identical hash cannot be.

`SignalWithValue`, `TickerSignalsWithAtr` and `Omit<` are all gone. Neither field is optional:
`value: number | null` and `atr: number | null`, both required, so `| null` carries "no value" rather
than pushing the uncertainty into every consumer.

## What this closes

The canonical client type now matches the API. Slice 2 of the ticker page and Risk & Perf will both
consume this response; neither will need to rediscover that the declaration was stale.

The lesson from 0086's report stands and is worth restating, since it will recur: **when a contract
changes an API response shape, the typed client is part of that change.** 0085 was backend-only by
design and 0086 did not name `client.ts`, so the gap fell between two contracts that were each
internally correct.

## Status

Accepted and archived.
