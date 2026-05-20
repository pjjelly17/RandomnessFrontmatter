# Randomness Frontmatter

A fork of [Randomness](https://github.com/Obsidian-TTRPG-Community/Randomness)
adding a public JS API, frontmatter property writes, a quick-roll palette,
session-log auto-append, roll history, and vault-global used-result tracking.
DM-cockpit additions on top of the upstream IPP3 engine — every original
feature still works identically.

Roll on tables inline with `` `rdm:[@Names]` ``, embed full generators in
````randomness```` codeblocks, and re-use existing `.ipt` files from twenty
years of the [Inspiration Pad](https://nbos.com/products/inspiration-pad)
ecosystem.

## What this fork adds (Phase 1)

- **Public JS API** at `app.plugins.plugins["randomness-frontmatter"].api`
  — `roll`, `rollExpression`, `rollUnscoped`, `rollIntoProperty`, `tables`,
  `tablesWithSources`, `onRoll`. Stable contract for third-party plugins,
  Templater scripts, and DataviewJS consumers.
- **Roll into frontmatter property** — command palette → "Roll table into
  frontmatter property…". Two-step modal: pick table, type property key,
  Enter. Result lands in the active note's frontmatter via
  `app.fileManager.processFrontMatter`. Picks any vault `.ipt` table;
  out-of-scope tables auto-add a `Use:` line so the next inline call to
  the same table works without re-running anything.
- **Quick-roll palette** — command palette → "Quick roll table…". Fuzzy
  pick any vault table, get a result + clipboard copy. Zero note mutation.
- **Session log auto-append** — every roll can optionally append a
  `- MM/DD/YYYY HH:MM rolled <table>: <result>` line to the most-recent
  session note (resolved by frontmatter `type: session`, sorted by `date:`
  DESC). Toggle is OFF by default; flip it on for live game logging.
- **Emit-on-error** — broken `.ipt` files don't vanish anymore. Failed
  rolls produce a `[ROLL ERROR: <message>]` result that flows through the
  same event bus as successes, so the session log and history capture
  attempts that failed. Diagnostic feedback for free.
- **Roll history** — every roll persisted to `_rolls/history.md` (markdown,
  browsable directly in Obsidian — not opaque JSON). New "Open roll
  history" command opens a sidebar view with newest-first list, per-row
  reroll button (↻), and Mark used / Unmark buttons.
- **Used / Unused tracker** — mark a rolled result as used so future rolls
  with `excludeUsed: true` skip it (re-rolls up to 20 times). State stored
  vault-globally at `_rolls/used.md`. Auto-mark on roll-into-property
  (toggle-gated, default ON); manual mark/unmark from the history view.

## Features (upstream)

- **`randomness` codeblocks** — embed a generator directly in a note. Rolls
  every render; supports the full IPP3 grammar including weighted tables,
  lookup tables, deck picks, conditionals, dice, expressions, and 21 filters.
- **Inline `rdm:` calls** — one-shot rolls scattered through your prose.
  Preview first, then click 🔒 to commit the result as
  `` `rdm:[@Names]⟹Alice` `` — the lock survives reloads, syncs, and
  reopening the vault. Click 🎲 to re-roll.
- **`Use:` other files** — share table libraries across notes. Reference
  `.ipt` files or `.md` notes containing `randomness` codeblocks; resolution
  follows the calling note's folder first, then a configurable generator root.
- **Prompts** — generators that declare `Prompt:` controls render dropdowns
  or text inputs above the output; changing a value re-rolls with the new
  prompt set.
- **Deterministic when you want it** — every codeblock can be configured to
  use a stable seed (off by default), so the same source at the same
  location produces the same roll on every render. Locks remain the
  strongest guarantee.
- **Generator browser pane** — a right-sidebar view that displays
  every `.ipt` file in your configured Generator root (or whole
  vault) as a collapsible folder tree mirroring your vault's
  structure. Click a folder or file chevron to expand; click any
  table's **Roll** button to generate a result, or **📋** to copy
  an inline `rdm:` reference for that table to your clipboard
  (paste into prose; the Notice shows the `Use:` line you'll need
  to add to your note). Click the result body to copy the rendered
  text. The tree starts fully collapsed and remembers what you
  expand across sessions. A "Collapse all" button resets the tree
  without clearing your search filter, so collapse-then-filter is a
  fast way to find a specific generator in a deep folder hierarchy.
  Open via the dice ribbon icon or the "Open generator browser"
  command.
- **Existing `.ipt` files work as-is.** The engine survives the full
  AddCommas/Random-Treasure-CR1-CR30 stress test from the NBOS corpus.

## Install

### Via BRAT (recommended while in beta)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin if you don't have it.
2. Open BRAT settings → Add Beta Plugin → enter this repo's URL.
3. Enable "Randomness" under Community Plugins.

## Usage

### Codeblocks

````markdown
```randomness
Table: Settlement
Riverbend
Stonewatch
Greenhollow
```
````

Renders to one of "Riverbend", "Stonewatch", or "Greenhollow", chosen at
random each time the codeblock renders.

Use the full IPP3 grammar — multiple tables, weighted entries, lookup
tables, `Set:`/`Define:`, prompts, conditionals, dice expressions, filters,
the lot:

````markdown
```randomness
Prompt: Tier {Easy|Normal|Hard}Normal
Table: Encounter
1: A single goblin scout.
2: [@Group] goblins.
6: A goblin chieftain with [1d4+2] {$prompt1} guards.

Table: Group
1-3: small group of {2d4}
4-6: warband of {3d6}
```
````

The dropdown for `Tier` appears above the result; changing it re-rolls.

### Inline `rdm:`

Anywhere in your prose, wrap an expression in backticks with the `rdm:`
prefix:

```markdown
The shopkeeper, a `rdm:[@Names]` from `rdm:[@Origin]`, eyed me suspiciously.
```

Each `` `rdm:...` `` renders inline with a preview, plus 🔒 (lock) and 🎲
(re-roll) buttons. Clicking 🔒 rewrites the underlying text to include the
chosen result:

```markdown
The shopkeeper, a `rdm:[@Names]⟹Tessith Vone` from `rdm:[@Origin]⟹Coppertown`, eyed me suspiciously.
```

The lock survives reloads, sync, and reopening the vault. To re-roll a
locked call, click 🎲 — it strips the lock and shows a fresh preview.

The expression's scope sees same-note `randomness` codeblocks plus any
`Use:` declarations from those blocks, so you can keep table definitions
alongside the prose that uses them.

### Sharing tables across notes

In a shared `.ipt` file (e.g. `Generators/common-names.ipt`):

```
Table: Names
Tessith Vone
Korad the Blue
Mira Thornhaven
```

In any note's codeblock:

````markdown
```randomness
Use:common-names.ipt
Table: NPC
{1d2=1, A man named, A woman named} [@Names].
```
````

`Use:` paths resolve relative to the current note's folder first, then
relative to the **Generator root** configured in Settings → Randomness.

### Commands

- **Lock all unfilled `rdm:` in current note** — evaluates every unfilled
  inline call (using cached previews where available, fresh evaluations
  otherwise) and writes all locks in one atomic save.
- **Reroll all `rdm:` in current note** — strips every lock and clears
  cached previews. The next render shows fresh previews everywhere.
- **Roll table into frontmatter property…** *(fork)* — pick any vault table,
  type a property key, Enter. Result lands in the active note's frontmatter.
  Out-of-scope tables auto-add a `Use:` line.
- **Quick roll table…** *(fork)* — fuzzy-pick any vault table, get a result
  via Notice + clipboard. No note mutation.
- **Open roll history** *(fork)* — opens the history sidebar view with
  reroll + mark-used buttons per row.

## Public JS API

Stable surface at `app.plugins.plugins["randomness-frontmatter"].api`.
All methods return `Promise<RollResult>` (or its variants); errors emit
through `onRoll` before re-throwing so subscribers see every attempt.

```ts
interface RandomnessFrontmatterAPI {
    version: string;
    roll(tableName: string, opts?: RollOptions): Promise<RollResult>;
    rollExpression(rawExpr: string, opts?: RollOptions): Promise<RollResult>;
    rollUnscoped(tableName: string, filePath: string): Promise<RollResult>;
    rollIntoProperty(key: string, tableName: string, opts?: RollOptions): Promise<RollResult>;
    tables(callerNotePath?: string): Promise<string[]>;
    tablesWithSources(callerNotePath?: string): Promise<TableSource[]>;
    onRoll(callback: (result: RollResult) => void): () => void;  // returns unsubscribe
}

interface RollOptions {
    callerNotePath?: string;
    excludeUsed?: boolean;  // retry up to 20 times to skip used results
}

interface RollResult {
    result: string;
    table: string;
    expression: string;
    source: string | undefined;  // caller notePath at time of roll
    timestamp: string;            // ISO 8601
    rollId: string;               // UUID v4
    error?: string;               // set when this attempt threw inside the evaluator
    allUsed?: boolean;            // set when excludeUsed exhausted the table
}
```

## Settings

- **Generator root** — vault-relative folder used as the fallback for
  `Use:` paths that don't resolve next to the calling note.
- **Default formatting** — `HTML (rich)` to enable bold/italic/list
  filters as visual formatting; `Plain text` to keep them as plain
  characters. Individual generators can override via the `Formatting:`
  directive.
- **Stable codeblock seeds** — when on, codeblocks render the same result
  across reloads (until you reroll). Useful for keeping a generator
  "settled" without committing to a specific lock. Off by default.

### Session log auto-append *(fork)*

- **Auto-append rolls to active session note** — toggle (default OFF).
  When on, every successful roll appends a log line to the resolved
  session note.
- **Session frontmatter key / value** — which frontmatter key/value
  combination identifies a session note. Defaults: `type` / `session`.
  Most-recent `date:` field wins among matches; ties broken by mtime.

### Roll history *(fork)*

- **Record roll history** — toggle (default ON). Persists every roll to
  `_rolls/history.md` (markdown, browsable in Obsidian directly).
- **History cap** — maximum entries to keep (default 50; clamped 10–500).
  FIFO eviction once full.

### Used / Unused state *(fork)*

- **Auto-mark roll-into-property results as used** — toggle (default ON).
  Result is added to the used set after the frontmatter write lands.
- **Exclude used when rolling into property** — toggle (default OFF).
  When on, the resolver re-rolls (up to 20 attempts) to find an unused
  result before committing to frontmatter.

## Where inline `rdm:` calls work

Inline `rdm:` calls render in **Reading view** only. Obsidian's
**Live Preview** uses a different rendering pipeline (CodeMirror 6
extensions, not markdown post-processors), and the plugin doesn't
have a CM6 extension yet. In Live Preview the inline calls show as
plain code spans — locks in the source survive, but the 🔒/🎲
buttons don't appear.

Workflow recommendation: author your prose in Live Preview, switch
to Reading view (Ctrl/Cmd-E or the read-eye icon) to roll/lock
inline calls. Locks written from Reading view show up in Live
Preview's underlying source immediately.

Codeblock generators (`` ```randomness ``) work in both views —
those use the codeblock processor, which Live Preview does handle.

## Attribution

This plugin is MIT-licensed (see [LICENSE](LICENSE)).

The IPP3 (Inspiration Pad Pro 3) grammar and file format are the work of
[NBOS Software](https://nbos.com). Their Inspiration Pad ecosystem is the
reason a generator written in 2008 still rolls today; this plugin aims to
be a faithful, modern execution environment for that work, not a
replacement for it. Use the original tools where they fit your workflow
better — and consider supporting NBOS.

Generator content (`.ipt` files) from the wider community remains the
copyright of its original authors and is governed by whatever licenses
those authors chose. The plugin does not include or distribute generator
content; the corpus shipped in the dev repo is for testing only.

Architecture in three layers:

- **Engine** (`src/engine/`) — pure IPP3 evaluator. AST, parsers,
  expression evaluator with seedable PRNG, 21 filters, recursion guard.
- **Resolver** (`src/resolver/`) — `Use:` graph traversal,
  markdown-codeblock extraction, inline scope assembly. Synchronous;
  async backend via `asyncPrefetcher`.
- **Views** (`src/views/`) — the only layer that imports Obsidian.
  Codeblock processor, inline processor, settings, lock/reroll state
  machine, prompt UI, HTML sanitiser.

