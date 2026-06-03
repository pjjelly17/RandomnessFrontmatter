---
project: randomness-frontmatter
effort: E3
phase: verify
progress: 60/62
mode: build
started: 2026-05-20
updated: 2026-06-03
upstream: Obsidian-TTRPG-Community/Randomness
fork_baseline: 1.0.11
prior_baseline: 0.4.4
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
- [x] ISC-22: `sessionAutoAppend` toggle in settings (default OFF); UI heading "Session log auto-append" in RandomnessSettingsTab
- [x] ISC-23: `sessionTypeKey` + `sessionTypeValue` text settings (defaults `type` / `session`)
- [x] ISC-24: `appendRollToSessionNote` registered via `api.onRoll` in main.ts L74-75; writes `- HH:MM rolled <table>: <result>` via vault.modify
- [x] ISC-25: `resolveSessionNote` sorts by frontmatter `date:` (parsed via `new Date()`) DESC then `file.stat.mtime` DESC; missing date falls back to mtime
- [x] ISC-26: Bail-fast on `!sessionAutoAppend`; `resolveSessionNote` returns null for empty selector / no match → silent; vault errors logged to console.warn only
- [x] +Bonus: WeakMap-keyed append queue in sessionLogAppender — serialises back-to-back rolls so fast-fire sessions can't lose entries via read-modify-write race (Forge addition; +7 unit tests)
- [x] Build green (`bun run build` exit 0); 806 tests pass (+7 from baseline 799)

**Behavior-verification pending PJ smoke test.**

### Phase 1 — Item 5: Roll history
- [x] ISC-27: History persisted to `_rolls/history.jsonl` (vault adapter write, JSON Lines, per-plugin write queue for race safety)
- [x] ISC-28: Each entry `{rollId, table, result, expression, timestamp, sourcePath, error?}` — added optional `error` for failure-flagged rolls
- [x] ISC-29: FIFO eviction at `historyMaxEntries` (default 50; clamped to [10, 500])
- [x] ISC-30: `RollHistoryView` (ItemView, dice icon) registered; command "Open roll history" opens it in a right-sidebar leaf
- [x] ISC-31: Each row has ↻ reroll button → `api.roll(table, { callerNotePath })`; view refreshes after success
- [x] ISC-32: `historyEnabled` toggle in settings (default ON) — bail-fast at appendRollToHistory entry
- [x] +Bonus: `RollResult.source` now populated (was hardcoded `undefined`) — covers success path (notePath), unscoped path (synthetic `__quick_roll__:` value), and failure path (notePath via emitFailureResult sourcePath arg)
- [x] Build green (`bun run build` exit 0); 811 tests pass (+4 from baseline 807)

**Behavior-verification pending PJ smoke test.**

### Phase 1 — Item 6: Used/Unused state (vault-global variant)
- [x] ISC-33 modified: Single vault-global state file `_rolls/used.md` (markdown, mirrors history format). Per-`.ipt` scope dropped — PJ confirmed multi-campaign single-vault setup makes per-file scope wrong; vault-global is the right granularity.
- [x] ISC-34: Mark/unmark button per row in RollHistoryView (✓ Mark used / ↶ Unmark); auto-mark on rollIntoProperty success when `autoMarkUsedOnRollIntoProperty` setting is ON (default ON)
- [x] ISC-35: `excludeUsed?: boolean` opt on RollOptions; `rollExpression` + `rollUnscoped` retry up to 20 attempts to find an unused result; fallback flags `allUsed: true` on RollResult so consumers can Notice
- [x] ISC-36 dropped: `#Track: used` directive deliberately out-of-scope. PJ controls dedup entirely via settings + API opt. ISC closed as unbuilt-by-design.
- [x] +Settings: `autoMarkUsedOnRollIntoProperty` (toggle, default ON), `excludeUsedInRollIntoProperty` (toggle, default OFF) under new "Used / Unused state" section
- [x] +Tracker: `usedTracker.ts` exports `usedKeyFor` (case-insensitive `${table}|${result}` key), `loadUsed`, `isUsed`, `markUsed`, `unmarkUsed`; per-plugin WeakMap write queue for race safety
- [x] Build green; 816 tests pass (+5 from baseline 811)

**Behavior-verification pending PJ smoke test.**

---

**Phase 1 — code-complete 2026-05-20.** All 6 items shipped. Behavior-verification of #6 pending PJ smoke test; items #1–#5 already behavior-verified live in NoStone5e.

### Cross-cutting / Anti-criteria
- [ ] ISC-37: Anti: existing `rdm:[@X]` inline syntax still works identically to upstream
- [ ] ISC-38: Anti: zero AI/LLM dependencies introduced (no `@anthropic-ai/*`, no `openai`, no `langchain`)
- [ ] ISC-39: Anti: no breaking change to `.ipt` file format
- [ ] ISC-40: Antecedent: PJ enables the fork in Settings → Community plugins before any of items 2-6 are user-testable

### Re-port onto upstream 1.0.11 (2026-06-03)
- [x] ISC-41: Branch `report/1.0.11` cut from `upstream/main` (1.0.11); old main tagged `pre-report-backup-0.4.4` (fully reversible) — verified `git describe` = 1.0.11
- [x] ISC-42: 7 fork-unique feature files brought onto branch (quickRoll, sessionLog, rollHistoryService/View, usedTracker, useInjection, rollIntoProperty) — verified `git status` shows 7 staged
- [x] ISC-43: Fork `src/api/index.ts` NOT present on branch (upstream's API canonical); features import types from upstream `../api` — verified `git diff --stat upstream/main -- src/api/index.ts` empty
- [x] ISC-44: `rollIntoProperty` re-homed into `rollIntoPropertyCommand.ts` using upstream `api.roll()` + `app.fileManager.processFrontMatter` — build clean
- [x] ISC-45: `excludeUsed` retry re-homed into command layer — capped 20-attempt loop over `api.roll()` + `usedTracker.isUsed`, sets `allUsed` + Notice
- [x] ISC-46: 7 fork settings keys present (took fork `settings.ts` wholesale — upstream unchanged 0.4.4→1.0.11); `DEFAULT_SETTINGS has all expected fields` test passes
- [x] ISC-47: `main.ts` additively wires onRoll listeners (session, history) + roll-history view + 3 fork commands AFTER `this.api = createApi(this)`
- [x] ISC-48: `RollResult`/`TableSource` reconciled — dropped `isMain` (not on upstream TableSource), `rollUnscoped(name, {filePath})` opts object
- [x] ISC-49: `useInjection.ts` self-contained; `tableAutocomplete.ts` taken from fork wholesale (upstream unchanged)
- [x] ISC-50: manifest.json + package.json → id `randomness-frontmatter`, name "Randomness Frontmatter", version 0.2.0, upstream minAppVersion preserved
- [x] ISC-51: `bun run build` exit 0; tsc strict clean; main.js 117692 bytes
- [x] ISC-52: 962 tests / 39 suites green via `npx jest`; fork API test dropped, 3 feature tests (session/history/used) ported + passing
- [x] ISC-53: Anti: upstream `src/api/index.ts`, `src/resolver/vaultIndex.ts`, 1.0.11 features untouched — diff empty
- [x] ISC-54: Anti: zero AI/LLM deps after merge — grep package.json clean
- [ ] ISC-55: Antecedent: `main` NOT yet moved to branch — pending PJ smoke test in NoStone5e (correct gate; build+tests green but quickRoll + rollIntoProperty commands are UI-modal, never unit-tested in fork either)
### Phase 2 — `# Track: used` per-table dedup directive (2026-06-03, was deferred ISC-36)
- [x] ISC-56: `# Track: used` comment-channel directive recognized by `src/views/trackDirective.ts` (`fileDeclaresUsedTracking` / `lineDeclaresUsedTracking`); file-level scope; tolerant of `#`/`;`/`//` prefix, whitespace, case
- [x] ISC-57: Directive forces exclude-used + auto-mark in roll-into-property, OR'd with the global settings (`excludeUsedInRollIntoProperty || tracked`, `autoMarkUsedOnRollIntoProperty || tracked`) — per-table control the global setting can't express
- [x] ISC-58: Anti: engine UNTOUCHED — directive rides the comment channel (`fileParser.ts:64` skips `#`/`;`/`//`); no fileParser/ast/evaluator edits; preserves the re-port's decoupling + upstream backwards-compat
- [x] ISC-59: Anti: matcher rejects near-misses (`Tracker:`, `Track: unused`, missing colon, non-comment `Track: used`, item content) — `trackDirective.test.ts` covers 6 positives + 7 negatives
- [x] ISC-60: Build clean; full suite 977 tests / 40 suites green via `npx jest`
- [ ] ISC-61: Antecedent: smoke-verify in NoStone5e — add `# Track: used` to a real .ipt, roll-into-property twice, confirm no repeat + entry lands in `_rolls/used.md`
- [ ] ISC-62: [DEFERRED] quick-roll directive integration + table-level (not file-level) scope — future refinement, intentionally out of this slice

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
| upstream-pr-api | upstream contribution | public-api | no |

## Decisions

- 2026-05-20: Seed project ISA at `<project>/ISA.md` per v6.0.0+ doctrine; the old MEMORY/WORK ISA covered the concept iteration, this is the system of record for the fork going forward.
- 2026-05-20: API surface is the keystone. Items 2-6 must consume the API, not reach into engine internals. "Eat our own dogfood" principle.
- 2026-05-20: Forge spawned to write `src/api/index.ts` per E3 doctrine; the architectural decisions stay with me, the implementation is Forge's. Cato audit deferred to E4+ work.
- 2026-05-20: Side-by-side install (id `randomness-frontmatter`) means upstream Randomness keeps running for PJ's existing rolls — no flag day. Will revisit at v0.5 / public release.
- 2026-05-20: **refined: `tables()` strict-vs-silent.** Forge wrote strict-throw on first malformed `.ipt` (per spec letter); flipped to silent-skip + `console.warn` after review. Rationale: NoStone5e vault has 11k files; one weird `.ipt` shouldn't disable the whole API method. Matches upstream `TableAutocomplete.vaultTables()` behavior.
- 2026-05-21: **Upstream PR branch prepared** — `feature/upstream-api` cut from `upstream/main` (`b232216` / `0.4.4`) at worktree `/home/pj/code/RandomnessFrontmatter-upstream-pr`. One commit `e07a871` "feat: public JS API". Maintainer told PJ to submit after his own attempt errored.
- 2026-05-21: **Strip-for-upstream rules.** Cut from PR: `rollUnscoped` (uses fork-added 4th `noteSource` arg to `evaluateInlineExpression`; ship alongside engine tweak in the Quick-roll palette PR #2), `rollIntoProperty` (tied to fork-only `usedTracker`), `excludeUsed`/`allUsed`/retry helper (same), all `usedTracker` imports. Renamed `randomness-frontmatter` → `randomness` in log strings; interface `RandomnessFrontmatterAPI` → `RandomnessAPI`. Final shape: 344 lines of API + 29 tests across 6 describe blocks + 11-line additive `main.ts` patch.
- 2026-05-21: **Test-run deferred to PJ.** Branch created + committed locally; `npm install && npm test && npm run build` against upstream's config is PJ's next move (he asked for "branch + strip only" this turn). Per `[[feedback-audit-test-claims]]`, draft PR body marks the test run as PJ-to-confirm before opening the PR — do not pre-claim "all green" against upstream's environment.
- 2026-05-21: **Test-run skipped, PR filed anyway.** Work-AV blocked the Node install on PJ's Windows VM (winget + portable ZIP both off the table given the friction). PJ called Option B (skip test step, open PR with honesty caveat). PR opened from `pjjelly17:feature/upstream-api` → `Obsidian-TTRPG-Community/Randomness:main` as **PR #1** (https://github.com/Obsidian-TTRPG-Community/Randomness/pull/1). Body opens with explicit "I have not yet run npm install/test/build myself" disclosure so the maintainer treats his own run as the verification, not mine. Confidence backstop: fork's 43-test API suite (commit `77fa6f9`) was green on Linux against the same code paths the upstream PR's 29 tests cover.

- 2026-06-03: **PR #1 CLOSED-BUT-WON.** Maintainer couldn't build PJ's branch ("did not build successfully" — confirms PJ's own untested-caveat) but read the intent and shipped the API design as upstream canon in 0.7.0; upstream now 1.0.11 carrying the same shape (`RandomnessAPI`, `RollResult`, `onRoll`, `tablesWithSources`) PLUS `rollUnscoped` and new features. Universal goal achieved.
- 2026-06-03: **"Rebase" → re-port, not literal `git rebase`.** Fork and upstream both have `src/api/index.ts` with different implementations of the same API; replaying fork's obsolete API commits onto 1.0.11 = conflict resolved by discarding fork's version anyway. Correct strategy: branch off `upstream/main` (1.0.11), forward-port ONLY the 7 fork-unique feature files, drop fork's API in favor of upstream's. Base drift on touch-files is small — `settings.ts` + `tableAutocomplete.ts` unchanged 0.4.4→1.0.11; only `main.ts` (+82) and `inlineProcessor.ts` (+14) moved.
- 2026-06-03: **`rollIntoProperty`/`excludeUsed`/`allUsed` re-home to command layer.** Upstream's public API (roll/rollUnscoped/rollExpression/tables/tablesWithSources/onRoll/version) did NOT adopt these — they were fork-only, tied to usedTracker. Per the ISA "API first" principle they belong in the consumer anyway: `rollIntoPropertyCommand.ts` now does `api.roll()` + `processFrontMatter` + the usedTracker exclude loop directly. This also keeps the feature layer decoupled from the engine — future re-ports get cheaper, and the companion-plugin option stays open.
- 2026-06-03: **Plugin id stays `randomness-frontmatter`.** Distinct from upstream `randomness` to avoid the codeblock/view-id collision ([[reference-obsidian-plugin-id-collision]]). Intended deployment: fork REPLACES upstream `randomness` in NoStone5e (fork = upstream 1.0.11 + feature layer, so one plugin suffices). PJ to confirm uninstalling upstream `randomness` to avoid running both. version → 0.2.0.

- 2026-06-03: **Re-port executed by primary (Forge run detached without writing).** Forge spawned for the mechanical port returned only a monitor banner, no file writes landed; primary did the port directly — surgical given the small base drift. Files: `settings.ts`+`tableAutocomplete.ts` taken from fork wholesale (upstream unchanged); `inlineProcessor.ts` left as upstream's (fork's change was rollUnscoped support, now native upstream); `main.ts` 3-way merged; `quickRollCommand.ts`+`rollIntoPropertyCommand.ts` adapted to upstream API; manifest/package re-identified. Result: build clean, 962 tests / 39 suites green.
- 2026-06-03: **Advisor (commitment-boundary) flagged the test gap honestly.** quickRoll (PJ's daily driver) + the re-homed rollIntoPropertyCommand have NO dedicated unit tests — but neither did the fork (both were always smoke-verified). The re-port did NOT regress coverage; the 3 feature files that had tests (session/history/used) still do. The one genuinely-NEW testable bit is the exclude-used retry now living in the command layer. Decision: do NOT overclaim "done"; hand back with the gap scoped in the same breath as the 962; smoke test is the established verification path for these UI commands; offer a focused exclude-used unit test as a quick follow-up. Main NOT promoted (ISC-55 gate held correctly).

## Changelog

### 2026-05-20 — code-read verification ≠ behavior verification

- **conjectured:** API verified by Read/Grep of `src/api/index.ts` was sufficient evidence for ISC-1–10 pass
- **refuted_by:** PJ audit question "we have not tests the js api in ours then?" — `rg "rollExpression|rollUnscoped|rollIntoProperty|onRoll" __tests__/` returned ZERO test files exercising these methods. Type-only imports in two view tests were the entire API test surface.
- **learned:** "verified Read 194 lines" demonstrates the symbol exists, not that it behaves correctly. The underlying engine + resolver paths being well-tested doesn't transitively cover the API facade — wiring bugs, error-emission contracts, listener semantics, retry caps all live ONLY in the API layer and need their own probes.
- **criterion_now:** ISCs claiming behavioral contracts (return shapes, error paths, event emissions, side effects) MUST cite a test-pass probe (`bun run test` line + assertion), not a code-Read probe. Code-Read remains valid for ISCs about file existence, signature, or type-level claims.

## Verification

### 2026-05-20 — Phase 1 API behavior verification

Test-pass evidence via `npx jest`:
- `__tests__/api/index.test.ts` (807 lines, 43 tests, all green; 0.6s wall)
- Full repo sweep: 29 suites, 859 tests passing (816 prior + 43 new, zero regressions; 8s wall)
- ISC-1–10 now upgraded from Read-evidence to test-pass evidence per the criterion_now in the Changelog entry above
- Coverage per method: version (2) · roll (10, incl. excludeUsed retry cap + UUID uniqueness) · rollUnscoped (3) · rollExpression (7) · rollIntoProperty (5, incl. processFrontMatter mock assertion + auto-mark-used toggle) · tables (3, dedup + scope) · tablesWithSources (7, shape + sources populated) · onRoll (6, success + error + unsubscribe + multi-subscriber + listener-throw swallow)
- Three potential API behaviors surfaced by Forge during test writing (recorded in `drafts/upstream-pr-api.md` honest-caveats section for the upstream PR): rollIntoProperty used-key uses user-supplied table name not canonical identity; tablesWithSources silently swallows both stage failures; excludeUsed retry re-prefetches Use: graph each attempt.

### 2026-05-20 — Phase 1 items 1+2 code verification (initial)

Static evidence (Read/Grep against shipped files):
- ISC-1–10 (Public JS API): All 10 ISCs verified by direct Read of `src/api/index.ts` and `src/views/main.ts` integration. Build green; types strict.
- ISC-11–17 (Frontmatter writes): All 7 ISCs verified by direct Read of `src/views/rollIntoPropertyCommand.ts` and `src/views/main.ts` registration.

Behavioral verification (pending PJ smoke test in NoStone5e — these aren't [DEFERRED-VERIFY] because the probe is possible at execution time; just gated on plugin enable):
1. Enable `randomness-frontmatter` in Settings → Community plugins
2. Dev console (Ctrl+Shift+I): `await app.plugins.plugins["randomness-frontmatter"].api.tables()` should return an array of table names from `6 - Tables/`
3. Dev console: `await app.plugins.plugins["randomness-frontmatter"].api.roll("Faction")` should return a `RollResult` with a rolled faction
4. Command palette → "Roll table into frontmatter property…" → pick a table → type a key (e.g. `faction`) → press Enter → frontmatter of active note should gain that key with the rolled value, Notice confirms
5. Anti ISC-37: existing `` `rdm:[@Faction]` `` calls in your brainstorm doc should still render normally in Reading view
