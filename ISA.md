---
project: randomness-frontmatter
effort: E3
phase: verify
progress: 17/40
mode: build
started: 2026-05-20
updated: 2026-05-20
upstream: Obsidian-TTRPG-Community/Randomness
fork_baseline: 0.4.4
---

## Problem

Upstream Randomness (IPP3-compatible) ships rolled values into styled body spans and codeblock output, but values never reach Obsidian's data primitives — frontmatter properties, Bases queries, Templater context, a public JS API. Rolls cannot compose with the rest of the vault. PJ's NoStone5e campaign (40+ `.ipt` tables, ~11k notes, mobile-camping DM use) needs rolls that flow into structured data, not pixels.

## Vision

Euphoric surprise: a DM rolls "NPC Name" and the result instantly lands in the active note's frontmatter, becomes queryable in Bases, lights up backlinks, and is reachable from Templater scripts — all without leaving the editor or copy-pasting. Tables are first-class vault citizens; rolls are first-class data events.

## Out of Scope

- Re-implementing the IPP3 engine (we inherit it from upstream)
- AI/LLM features of any kind (PJ directive 2026-05-20; not part of the fork's identity)
- Phases 2/3/4 features in v0.1 (defer to later milestones)
- Mobile-specific layout for v0.1 (NoStone5e camping flow is Phase 1.5+)
- Live Preview (CodeMirror 6) extension in v0.1 (PJ uses Reading + Source views only)

## Principles

- **Rolls are data events, not decoration.** Every roll must be observable, addressable, and composable with vault primitives.
- **Backwards-compatible with upstream `.ipt`.** PJ has 40+ existing `.ipt` files; never break them.
- **Side-by-side install.** Plugin id `randomness-frontmatter` coexists with `randomness` until v0.1 proves stable.
- **No AI-leaning features.** Fork stays useful to users who don't trust LLMs.
- **API first.** Every user-facing feature should consume the public API, not reach into engine internals — eats own dogfood.

## Constraints

- Obsidian min app version: 1.4.0
- Bun for dependency management (no npm/npx)
- TypeScript; tsc must pass with `-skipLibCheck` (upstream baseline)
- esbuild for bundling (upstream config preserved)
- MIT license (upstream LICENSE kept with attribution)
- Plugin id stays `randomness-frontmatter` for v0.1
- No new Obsidian core API requirements beyond upstream's 1.4.0 floor

## Goal

Ship v0.1 of `randomness-frontmatter` with all 6 Phase 1 Foundation items implemented: public JS API, frontmatter-property writes, quick-roll palette, session-log auto-append, roll history, used/unused state. Verified working in PJ's NoStone5e vault against real `.ipt` tables, with Hot Reload-driven dev loop intact.

## Criteria

### Phase 1 — Item 1: Public JS API
- [x] ISC-1: `src/api/index.ts` exists and exports `RandomnessFrontmatterAPI` interface — verified Read 194 lines
- [x] ISC-2: API has `version` string field — `version: API_VERSION ("0.1.0")` at line 115
- [x] ISC-3: `api.roll(tableName, opts?)` returns `Promise<RollResult>` — line 102-112, RollResult shape complete
- [x] ISC-4: `api.rollExpression(rawExpr, opts?)` accepts any IPP3 expression — line 76-100, calls `evaluateInlineExpression` directly
- [x] ISC-5: `api.rollIntoProperty(key, tableName, opts?)` writes via `processFrontMatter` — line 118-133
- [x] ISC-6: `api.tables(callerNotePath?)` returns deduped sorted table names — line 135-160, silent-skip on parse errors (flipped from Forge's strict-throw, see Decisions)
- [x] ISC-7: `api.onRoll(cb)` returns unsubscribe — line 150-155
- [x] ISC-8: `plugin.api` attached in `onload()` — main.ts line ~55 `this.api = createApi(this)`
- [x] ISC-9: `bun run build` exit 0 — confirmed, main.js 87K
- [x] ISC-10: Errors throw with descriptive messages — `readTableNames` throws with file path + cause; listener errors logged via console.error

### Phase 1 — Item 2: Frontmatter writes
- [x] ISC-11: Command `randomness-frontmatter:roll-into-property` registered — main.ts onload calls `registerRollIntoPropertyCommand(this)`
- [x] ISC-12: SuggestModal lists tables — `TableSuggestModal` in rollIntoPropertyCommand.ts, fed by `api.tables()`
- [x] ISC-13: Property key prompt — `PropertyKeyModal` second step
- [x] ISC-14: Frontmatter write via `app.fileManager.processFrontMatter` — api.ts line 129
- [x] ISC-15: Notice confirms result + key — `new Notice(\`Rolled [@${table}] → ${key}: ${rollResult.result}\`)`
- [x] ISC-16: Overwrite behavior — inherent to `processFrontMatter` (assigns to `fm[key]`); documented in code
- [x] ISC-17: No-active-file branch — checks `getActiveFile() instanceof TFile`, returns with Notice

**Behavioral ISCs (modal interaction, frontmatter write actually landing) pending PJ smoke test in Obsidian — see Verification section.**

### Phase 1.5 — Auto-add `Use:` on out-of-scope table pick (scope-mismatch fix)
- [x] ISC-17a: `src/views/useInjection.ts` created; exports `findFirstRandomnessCodeblock` (L42), `findFrontmatterEnd` (L85), `ensureUseInScope` (L118), `ensureUseInSource` (L202, new — string variant for vault.modify fallback path)
- [x] ISC-17b: `tableAutocomplete.ts` imports from useInjection.ts; private helpers removed; re-export shim keeps existing test imports working; 799 tests pass
- [x] ISC-17c: `TableSource` interface exported from api/index.ts (L44): `{ name, source, isMain, inScope, filePath }`
- [x] ISC-17d: `api.tablesWithSources(callerNotePath?)` added (L196-291); in-scope built via vaultFileSource+prefetchUseGraph+buildInlineBundle, out-of-scope via discoverGenerators; silent-degrades on per-stage errors
- [x] ISC-17e: `api.tables()` untouched
- [x] ISC-17f: rollIntoPropertyCommand uses `tablesWithSources()`; out-of-scope items render `(not imported) <source>` subtitle
- [x] ISC-17g: On out-of-scope pick: `injectUseLine` helper picks editor (preferred, preserves undo) or vault.modify fallback; Notice fires only when lines actually added
- [x] ISC-17h: Roll proceeds via existing `api.rollIntoProperty(key, name)` after injection
- [x] ISC-17i: In-scope picks bypass injection entirely (branch at command line 218)
- [x] ISC-17j: `bun run build` exit 0; tsc strict passes; 799 tests green; main.js 88974→91342 bytes

**Behavior-verified by PJ in NoStone5e 2026-05-20 (commit `39553cd`). Out-of-scope pick → Use: line written → roll lands → frontmatter populated. All 10 Phase 1.5 ISCs live.**

### Phase 1 — Item 3: Quick-roll palette
- [x] ISC-18: Command `randomness-frontmatter:quick-roll` registered (quickRollCommand.ts L90, main.ts L124)
- [x] ISC-19: `QuickRollSuggestModal` with case-insensitive substring fuzzy search; filters `tablesWithSources()` to `inScope === true` (L26)
- [x] ISC-20: On selection `api.roll(name)` → clipboard.writeText (Wayland-safe try/catch) + Notice `[@name] → result` truncated to 120 chars
- [x] ISC-21: Fresh modal + fresh `tablesWithSources()` call per invocation; no module-level cache

**Behavior-verified by PJ 2026-05-20 — quick-roll fires + clipboard populated (commit `6c266dd`).**

### Phase 1 — Item 4: Session-log auto-append
- [ ] ISC-22: Setting toggle: "Auto-append rolls to active session note"
- [ ] ISC-23: Setting: "Active session note frontmatter selector" (default: `type: session` + most-recent `date:`)
- [ ] ISC-24: When ON, every API roll appends `- HH:MM rolled <table>: <result>` to the resolved session note
- [ ] ISC-25: Multiple session notes case: most recent wins, ties broken by mtime
- [ ] ISC-26: No-session-note case: silently skip (no notice spam)

### Phase 1 — Item 5: Roll history
- [ ] ISC-27: History persisted to `_rolls/history.jsonl` in vault (one JSON object per line)
- [ ] ISC-28: Each entry: `{rollId, table, result, expression, timestamp, sourcePath}`
- [ ] ISC-29: History cap: 50 entries by default (FIFO eviction)
- [ ] ISC-30: New view `RollHistoryView` accessible from sidebar
- [ ] ISC-31: Each history entry has a "reroll" button that re-invokes `api.roll(table)` with the same source path
- [ ] ISC-32: Setting toggle to disable history entirely (privacy-respecting default: ON)

### Phase 1 — Item 6: Used/Unused state
- [ ] ISC-33: Side-state file per `.ipt`: `<table>.used.json` map of rollId → used:true
- [ ] ISC-34: "Mark used" action available from history view + roll-into-property command
- [ ] ISC-35: API option `excludeUsed: true` filters out used results from the roll source
- [ ] ISC-36: Per-table opt-in via `#Track: used` directive in the `.ipt` file (does not break existing files)

### Cross-cutting / Anti-criteria
- [ ] ISC-37: Anti: existing `rdm:[@X]` inline syntax still works identically to upstream
- [ ] ISC-38: Anti: zero AI/LLM dependencies introduced (no `@anthropic-ai/*`, no `openai`, no `langchain`)
- [ ] ISC-39: Anti: no breaking change to `.ipt` file format
- [ ] ISC-40: Antecedent: PJ enables `randomness-frontmatter` in Settings → Community plugins before any of items 2-6 are user-testable

## Test Strategy

| isc | type | check | threshold | tool |
|-----|------|-------|-----------|------|
| ISC-1–10 | API | exists + types + invocation | each method callable from devtools | Bash `bun run build`, manual devtools |
| ISC-11–17 | command | execute via command palette | success Notice + frontmatter contains result | Interceptor (Obsidian view) or manual |
| ISC-18–21 | command | invoke + observe clipboard | clipboard contains result | manual |
| ISC-22–26 | session log | toggle on, roll, read session note | append line present with HH:MM + result | Read vault file |
| ISC-27–32 | history | roll N times, inspect jsonl | line count + JSON shape | Read `_rolls/history.jsonl` |
| ISC-33–36 | used state | mark used, re-roll with excludeUsed | result not in returned distribution | manual; future tests |
| ISC-37 | upstream compat | existing `rdm:[@Faction]` still rolls | unchanged behavior | Read vault note |
| ISC-38 | dependencies | grep package.json + lockfile | zero AI deps | Grep |
| ISC-39 | format | sample `.ipt` parses identically | unchanged AST | jest test in `__tests__/integration/` |
| ISC-40 | env | plugin enabled | toggled ON in community-plugins.json | Read |

## Features

| name | satisfies | depends_on | parallelizable |
|------|-----------|-----------|---------------|
| public-api | ISC-1–10 | — | no (keystone) |
| frontmatter-writes | ISC-11–17 | public-api | no |
| quick-roll-palette | ISC-18–21 | public-api | yes (after api) |
| session-log-append | ISC-22–26 | public-api | yes (after api) |
| roll-history | ISC-27–32 | public-api | yes (after api) |
| used-unused-state | ISC-33–36 | public-api, roll-history | no (needs history) |

## Decisions

- 2026-05-20: Seed project ISA at `<project>/ISA.md` per v6.0.0+ doctrine; the old MEMORY/WORK ISA covered the concept iteration, this is the system of record for the fork going forward.
- 2026-05-20: API surface is the keystone. Items 2-6 must consume the API, not reach into engine internals. "Eat our own dogfood" principle.
- 2026-05-20: Forge spawned to write `src/api/index.ts` per E3 doctrine; the architectural decisions stay with me, the implementation is Forge's. Cato audit deferred to E4+ work.
- 2026-05-20: Side-by-side install (id `randomness-frontmatter`) means upstream Randomness keeps running for PJ's existing rolls — no flag day. Will revisit at v0.5 / public release.
- 2026-05-20: **refined: `tables()` strict-vs-silent.** Forge wrote strict-throw on first malformed `.ipt` (per spec letter); flipped to silent-skip + `console.warn` after review. Rationale: NoStone5e vault has 11k files; one weird `.ipt` shouldn't disable the whole API method. Matches upstream `TableAutocomplete.vaultTables()` behavior.

## Changelog

(empty at fork seed — will fill via Skill("ISA", "append changelog ...") as conjectures get refuted)

## Verification

### 2026-05-20 — Phase 1 items 1+2 code verification

Static evidence (Read/Grep against shipped files):
- ISC-1–10 (Public JS API): All 10 ISCs verified by direct Read of `src/api/index.ts` and `src/views/main.ts` integration. Build green; types strict.
- ISC-11–17 (Frontmatter writes): All 7 ISCs verified by direct Read of `src/views/rollIntoPropertyCommand.ts` and `src/views/main.ts` registration.

Behavioral verification (pending PJ smoke test in NoStone5e — these aren't [DEFERRED-VERIFY] because the probe is possible at execution time; just gated on plugin enable):
1. Enable `randomness-frontmatter` in Settings → Community plugins
2. Dev console (Ctrl+Shift+I): `await app.plugins.plugins["randomness-frontmatter"].api.tables()` should return an array of table names from `6 - Tables/`
3. Dev console: `await app.plugins.plugins["randomness-frontmatter"].api.roll("Faction")` should return a `RollResult` with a rolled faction
4. Command palette → "Roll table into frontmatter property…" → pick a table → type a key (e.g. `faction`) → press Enter → frontmatter of active note should gain that key with the rolled value, Notice confirms
5. Anti ISC-37: existing `` `rdm:[@Faction]` `` calls in your brainstorm doc should still render normally in Reading view
