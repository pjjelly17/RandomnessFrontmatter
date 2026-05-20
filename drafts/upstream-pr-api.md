# Draft PR — Public JS API for plugin/script consumers

> Draft for the upstream `Obsidian-TTRPG-Community/Randomness` repo.
> Not yet opened. Edit freely; copy-paste body when you're ready to file.

---

**Title:** `feat: public JS API for plugin/script consumers`

**Branch name suggestion:** `feature/public-api`

**Target:** `Obsidian-TTRPG-Community/Randomness` ← `main`

---

## PR body

Hey 👋 picking up from the Discord chat — here's the public JS API as a PR.

### What & why

There's no documented way for other plugins, Templater scripts, or DataviewJS to programmatically roll a Randomness table today. The only options are reaching into plugin internals (fragile) or parsing rendered markdown after the fact (slow + lossy).

This PR adds a small, stable public surface so consumers can call `.roll()`, `.rollExpression()`, `.tables()`, etc. without poking at engine guts.

### API surface

Exposed at `app.plugins.plugins["randomness"].api`:

```ts
interface RandomnessAPI {
    version: string;

    /** Roll a named table. */
    roll(tableName: string, opts?: RollOptions): Promise<RollResult>;

    /** Roll an arbitrary expression (e.g. "[@Names] from [@Origin]"). */
    rollExpression(rawExpr: string, opts?: RollOptions): Promise<RollResult>;

    /** Roll a table from an explicit .ipt file path — bypasses Use:-scope. */
    rollUnscoped(tableName: string, filePath: string): Promise<RollResult>;

    /** List table names visible from a given note. */
    tables(callerNotePath?: string): Promise<string[]>;

    /** List tables with their source paths. */
    tablesWithSources(callerNotePath?: string): Promise<TableSource[]>;

    /** Subscribe to every roll event. Returns an unsubscribe function. */
    onRoll(callback: (result: RollResult) => void): () => void;
}

interface RollOptions {
    callerNotePath?: string;
    seed?: number;
    promptValues?: Record<string, string>;
}

interface RollResult {
    result: string;       // rendered output (or error marker text on failure)
    table: string;        // table name as requested
    expression: string;   // full expression evaluated
    source?: string;      // .ipt path if known
    error?: string;       // set only when this attempt threw
    timestamp: string;    // ISO 8601
    rollId: string;       // UUID for dedup
}
```

`onRoll` fires for every attempt including failures, so subscribers see the full event stream (useful for history capture, logging, downstream automations).

### Implementation notes

**New file:** `src/api/index.ts` (~543 lines including JSDoc + types).

The API is a thin orchestration layer over existing engine + resolver + view internals — no new evaluation logic, just a stable public contract. Wraps `evaluateInlineExpression`, `parseGeneratorFile`, `prefetchUseGraph`, `discoverGenerators`, `collectTablesFromBundle` from the existing code.

**Modified file:** `src/views/main.ts` — adds an `api` field on the plugin class and constructs the API surface in `onload()`. ~16 lines of wiring.

**No engine changes.** No resolver changes. No view changes beyond the `main.ts` wiring.

### Tests

Adds `__tests__/api/index.test.ts` — **43 tests across 8 describe blocks**, all green. Coverage:

- `version` — API_VERSION constant + non-empty string contract
- `roll` — happy path, unknown table, callerNotePath flow, `excludeUsed` retry cap (20 attempts → `allUsed: true`), unique `rollId` UUIDs, ISO 8601 timestamps
- `rollExpression` — single + multi-table expressions, invalid expression error path
- `rollUnscoped` — explicit file path resolution, unknown table in file, file-not-found
- `rollIntoProperty` — frontmatter write via `processFrontMatter` mock assertion, auto-mark-used toggle behavior, no-active-file error path
- `tables` — deduped string array, scope-respecting resolution
- `tablesWithSources` — `{name, source}[]` shape, source paths populated, dedup behavior
- `onRoll` — fires on success, fires on error, unsubscribe works, multiple subscribers, listener-throw is swallowed and logged

Full Jest sweep (`npx jest`): **29 suites, 859 tests, 859 passing** (816 prior + 43 new, zero regressions). Run time 8s.

Underlying engine/resolver paths these methods call are also covered by the existing `__tests__/engine/` + `__tests__/resolver/` + integration suites — so the API gets layered coverage from both directions.

### Backward compatibility

**Fully backward-compatible.** The API is additive — no existing user-facing surface changes. Existing codeblocks, inline `rdm:` calls, locks, `Use:` resolution, settings — all unchanged.

The `api` field on the plugin object is opt-in for consumers; users who never touch it see no difference.

### Use cases (concrete)

- **Templater:** roll an NPC name into a new note template
  ```js
  const api = app.plugins.plugins["randomness"].api;
  const npc = await api.roll("Names");
  tR += npc.result;
  ```
- **DataviewJS:** dashboard surfacing a fresh random encounter
- **Companion plugins:** chain rolls, write to frontmatter, etc.
- **Anyone scripting Obsidian** who currently has to shell out to dice rollers or scrape markdown

### Open questions / decisions for you

1. **Naming** — happy to rename methods if you have preferred verbs. `roll`/`rollExpression` matched the existing `rdm:` mental model in my fork; open to alternatives.
2. **Version field** — should `api.version` track the plugin version (`package.json`) or have an independent version for the API contract? I went with an independent `"0.1.0"` constant in the fork so the API can evolve separately. Easy to change.
3. **Source path resolution** — `RollResult.source` is currently `undefined` in v0.1 because the engine doesn't expose the resolved `.ipt` path through `evaluateInlineExpression`. If you'd accept a small engine-side change to surface it, I'd add that in a follow-up PR.
4. **Async signatures everywhere** — every method returns a Promise even when the underlying call is sync, so we don't lock the surface if any of them later need async work (file I/O on prefetch, etc.). If you'd prefer sync-where-possible, I can split.

### Out of scope (intentionally)

This PR is just the API. Not included:
- Frontmatter-property writes (separate feature, stays in my fork — it's tied to my used-tracker)
- Roll history persistence (also stays forked)
- Session log auto-append (forked)
- Used/unused state (forked)

If the API lands, I'd queue a separate small PR for the **quick-roll command palette** that builds on this surface.

### Working implementation

Lives in my fork at [`pjjelly17/RandomnessFrontmatter`](https://github.com/pjjelly17/RandomnessFrontmatter) — `src/api/index.ts` (543 lines including JSDoc + types) with `__tests__/api/index.test.ts` (43 tests, all green). In production use against a 3-year-active D&D campaign vault.

Happy to amend scope, naming, test patterns, or anything else. Thanks for being open to changes — appreciated.

---

## Local prep checklist (before opening this)

- [ ] Discord confirmation from maintainers ✓ once received
- [x] **Add basic API tests (`__tests__/api/index.test.ts`)** — DONE 2026-05-20: 43 tests, all green, no regressions in repo-wide sweep
- [ ] Branch off `upstream/main` (currently at `b232216` — `0.4.4`)
- [ ] Cherry-pick `b06ef77` — handle conflict on `src/views/main.ts` (theirs has v0.4.x autocomplete changes ours doesn't)
- [ ] Remove non-API content from the picked commit:
  - [ ] Drop `ISA.md` (fork-internal)
  - [ ] Drop `bun.lock` (upstream uses npm)
  - [ ] Drop `main.js` (built artifact; upstream will rebuild)
  - [ ] Drop `src/views/rollIntoPropertyCommand.ts` (separate feature)
  - [ ] Trim `src/views/main.ts` changes to API wiring only (drop rollIntoProperty command registration)
- [ ] Run upstream's test suite against the rebased branch — confirm green
- [ ] Verify upstream's lint/format passes (if they have one configured)
- [ ] Push branch to `pjjelly17/RandomnessFrontmatter` as `feature/upstream-api`
- [ ] Open PR from that branch into `Obsidian-TTRPG-Community/Randomness:main`
- [ ] Drop a Discord note once PR is live

## Commit-isolation strategy

The current `b06ef77` commit bundles:
- API (want upstream) → 201 lines, `src/api/index.ts`
- roll-into-property command (keep forked) → 150 lines, `src/views/rollIntoPropertyCommand.ts`
- main.ts wiring (need to split: API portion goes upstream, command-registration portion stays forked)

Cleanest approach: **don't cherry-pick `b06ef77`**. Instead, on a fresh branch off `upstream/main`:

1. `cp` the API file in: `src/api/index.ts`
2. Manually add only the API-wiring lines to `src/views/main.ts` (the `this.api = createApi(this)` part, not the command registration)
3. Write the basic test file
4. Single new commit: `feat: public JS API`

That gives a clean, focused PR with one logical commit and no rebase pain.

## Honest caveats to surface in review

- `RollResult.source` is `undefined` in v0.1. If they want this populated, I'd need a small engine-side change in a follow-up.
- `seed` and `promptValues` in `RollOptions` are accepted but no-op in v0.1 (engine signature limitations). Could be addressed in a follow-up.
- 3 potential API behaviors surfaced during test writing (worth flagging upstream as discussion items, not necessarily blockers):
  1. `rollIntoProperty` marks results used keyed on the user-supplied `tableName`, not a canonicalized table identity — fine while tables aren't canonicalized, but a silent mismatch waiting to happen.
  2. `tablesWithSources` silently swallows failures from BOTH stages (in-scope build + vault scan). Returns `[]` + two console warnings when both throw — arguably should surface an aggregate error.
  3. `roll`'s `excludeUsed` retry calls `evaluateInlineExpression` (which re-prefetches the Use: graph each attempt) — 20 retries hammer prefetch. Hot but acceptable for v0.1.

These should be in the PR body so maintainers see them upfront, not surprises during review.
