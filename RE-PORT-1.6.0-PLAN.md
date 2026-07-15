# Re-port onto upstream 1.6.0 — plan (cold-resume)

**Status:** DECIDED 2026-07-14, **not yet executed**. Decision + sizing only.
**Baseline:** fork `randomness-frontmatter` v0.2.0 = upstream **1.0.11** + feature layer.
**Target:** upstream **1.6.0** (`upstream/main` HEAD `074276d`, tag `1.6.0`).

## Decision

Keep the fork; re-port the feature layer onto 1.6.0. NOT fold-to-stock-upstream
(loses the data layer), NOT companion-plugin (for now).

**Why:** everything PJ values is either core-engine (dice rolling + `.ipt`
generators — comes free with the re-port) or the fork-only data layer (kept).
The upstream parts he wants — the **Dice Roller merge** (1.3.0) + the **1.3.x
engine bugfixes** — only exist at 1.3.0+, so a re-port is the way to get them.
Portraits / decks / cards (upstream's other new work) = don't care; they tag
along inert.

## What changed upstream since 1.0.11

- **1.3.0 — Dice Roller merge**: absorbed the discontinued Dice Roller plugin
  (backward-compat), Fantasy Statblocks + Initiative Tracker support. New:
  `engine/dice.ts`, `compat/diceCompat.ts`, `views/{diceRollerShim,diceTrayView,lockingService}.ts`.
  The freeze-the-roll **Lock** is now a first-class `views/lockingService.ts`.
- **1.2.0**: auto-discovery of tables by name without explicit `Use:` (`resolver/autoDiscover.ts`).
- **1.4.0**: persistent decks (`src/decks/`, `views/{deckInlineProcessor,decksTab}.ts`).
- **1.5.0**: tag-roll filtering BY frontmatter props (AND/OR, multi-universe).
- **1.6.0**: dice breakdown on hover, deck card art, weather deck, `render3d/diceOverlay.ts`.

## Sizing (read-only recon, 2026-07-14) — mechanical merge, not a rewrite

The 8 fork feature files couple to upstream through **type-only imports of
`RollResult` + `TableSource` ONLY** — both survive the Dice Roller merge intact
in 1.6.0 (shapes verified). So the files drop in near-clean.

Fork feature files (all in `src/views/`):
`quickRollCommand`, `rollIntoPropertyCommand`, `sessionLogAppender`,
`rollHistoryService`, `rollHistoryView`, `usedTracker`, `useInjection`, `trackDirective`.

**Real work = three 3-way merges:**

1. **`main.ts`** — re-apply the additive onload wiring onto upstream's *much
   bigger* 1.6.0 onload: `this.api = createApi(this)` is upstream's now, then
   your 3 commands (quick-roll, roll-into-property, open-roll-history) + 2
   `onRoll` listeners (session-log, history) + the roll-history view
   registration, all AFTER `createApi`.
2. **`settings.ts`** — merge your 7 fork keys into upstream's GROWN settings
   (can't take wholesale like the 1.0.11 re-port — upstream added deck/portrait/
   dice options). Keys: `sessionAutoAppend`, `sessionTypeKey`, `sessionTypeValue`,
   `historyEnabled`, `historyMaxEntries`, `autoMarkUsedOnRollIntoProperty`,
   `excludeUsedInRollIntoProperty` (+ `activeCampaign` if Phase 5 is carried).
3. **Identity** — `manifest.json` + `package.json` → id `randomness-frontmatter`,
   name "Randomness Frontmatter", **version 0.3.0**, keep upstream `minAppVersion`.

## Procedure (mirrors the ISC-41–55 method from the 1.0.11 re-port)

1. `git fetch upstream --tags` (done). Tag current `main` as a backup first:
   `git tag pre-report-backup-0.2.0 main`.
2. Branch off upstream: `git switch -c report/1.6.0 upstream/main`.
3. Bring the 8 feature files across from old `main` (they import upstream's API,
   not the fork's — fork's `src/api/index.ts` is NOT carried; upstream's is canon).
4. 3-way merge `main.ts` + `settings.ts` (the two real merge points above).
5. Re-identify manifest/package (step 3 above).
6. `bun run build` (= `tsc -noEmit -skipLibCheck && esbuild`). Fix any drift.
7. Run tests: **`npx jest`** (NOT `bun test` — Jest config). Expect ~977; the
   feature tests (session/history/used/trackDirective) should pass unchanged.
8. Promote: `git switch main && git merge --ff-only report/1.6.0` (or reset),
   keeping `pre-report-backup-0.2.0` as the rollback.
9. Smoke-test in NoStone5e (Hot Reload picks up the rebuilt `main.js`).

## Gotchas

- **`.github/workflows/` needs gh token `workflow` scope** to push — bit the
  1.0.11 re-port. If the push 403s: `gh auth refresh -h github.com -s workflow`.
- **`useInjection.ts` may be partly redundant** now — upstream `autoDiscover.ts`
  (1.2.0) auto-finds tables without `Use:`. Check during the port; possible
  simplification, not a blocker.
- **Test runner:** `npx jest` / `npm test` / `bun run test` — never `bun test`.
- **Plugin-id collision:** keep id `randomness-frontmatter` distinct from upstream
  `randomness`; NoStone5e must not enable both (it doesn't today).

## Verification bar

Build clean + `npx jest` green + NoStone5e smoke (sidebar roll, quick-roll,
roll-into-property → frontmatter, used dedup, and the Dice Roller merge actually
present). ISC-61 CDP smoke stays the open verification path — needs Obsidian
launched from PJ's session (`obsidian --remote-debugging-port=9222`).
