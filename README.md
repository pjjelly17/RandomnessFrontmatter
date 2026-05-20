# Randomness Frontmatter

Randomness, tuned for running a table.

A fork of [Randomness](https://github.com/Obsidian-TTRPG-Community/Randomness)
that turns rolls into first-class data events: drop them inline, write them into
frontmatter, append them to your session log, mark them used so the same NPC
name doesn't show up twice. Built on top of the upstream IPP3 engine — every
original feature still works identically.

```markdown
The shopkeeper, a `rdm:[@Names]⟹Tessith Vone` from `rdm:[@Origin]⟹Coppertown`,
eyed me suspiciously.
```

Twenty years of `.ipt` files from the [Inspiration Pad](https://nbos.com/products/inspiration-pad)
ecosystem keep working without modification. Bring your corpus, the engine
handles it.

## What this fork brings to the table

Seven additions over upstream. Each one solves a real problem from running
real sessions.

### 🎲 Public JS API

Templater scripts, DataviewJS dashboards, other plugins — anything that wants
to roll a table can call `app.plugins.plugins["randomness-frontmatter"].api`.
Stable contract. Your code keeps working through future versions.

Methods: `roll`, `rollExpression`, `rollUnscoped`, `rollIntoProperty`,
`tables`, `tablesWithSources`, `onRoll`. Full surface documented below.

### 📝 Roll into frontmatter property

Command palette → "Roll table into frontmatter property…" → pick a table,
type a property key, Enter. The result lands in the active note's
frontmatter via Obsidian's atomic `processFrontMatter` API.

Picks any `.ipt` table anywhere in the vault. If it's out-of-scope, the
plugin auto-adds the `Use:` line so the next inline call to that table
just works — no manual wiring.

This is the feature that makes rolls Bases-queryable. Once a result is in
frontmatter, Templater can read it, Bases can filter on it, Dataview can
aggregate it. The roll becomes data, not decoration.

### ⚡ Quick-roll from anywhere

Cmd/Ctrl+P → "Quick roll table…" → fuzzy-pick → result on screen + auto-copied
to clipboard. No note touched, no codeblock written.

The fastest way to roll mid-session when you're mid-sentence and don't want
to break flow to find the dice ribbon.

### 📜 Session log auto-append

Toggle it on. Every roll appends a timestamped line to the current session
note:

```
- 11/14/2026 19:42 rolled Names: Tessith Vone
- 11/14/2026 19:43 rolled Encounter: A goblin chieftain with 3 small guards
```

"Current session note" is whatever has `type: session` and the most-recent
`date:` field. The keys are configurable. Default is OFF so it doesn't
clutter prep notes — flip it on when the session starts.

### 🛑 Emit-on-error

Broken `.ipt` files used to vanish silently. Now they produce a
`[ROLL ERROR: <message>]` result that flows through the same event bus as
successes. Your session log captures the attempt. Your history captures the
attempt. Diagnostic feedback for free.

### 📚 Roll history sidebar

Every roll persists to `_rolls/history.md` — markdown, not opaque JSON.
You can read it directly in Obsidian, version it in git, or query it with
Dataview.

The "Open roll history" command opens a sidebar view with newest-first
list, ↻ reroll button per row, and Mark used / Unmark buttons. Default cap
50 entries (FIFO, configurable 10–500).

### ✅ Used / Unused tracker

Mark a result as used. Future rolls with `excludeUsed: true` will retry
(up to 20 times) to find an unused result before committing.

State lives vault-globally at `_rolls/used.md`. Auto-marks on
roll-into-property (toggle-gated, default ON); manual mark/unmark from the
history view. Pick from a 50-name table without repeating across a
12-session campaign — no manual tracking required.

## Everything the upstream does, still works

Bringing your existing setup over? Nothing breaks. Every upstream feature
remains identical:

- **`randomness` codeblocks** — embed a generator in any note. Full IPP3
  grammar: weighted tables, lookup tables, deck picks, conditionals, dice,
  expressions, 21 filters.
- **Inline `rdm:` calls** — one-shot rolls scattered through prose. Click
  🔒 to commit the result back into the source; click 🎲 to re-roll.
  Locks survive reloads, syncs, and reopening the vault.
- **`Use:` other files** — share table libraries across notes. Reference
  `.ipt` files or `.md` codeblock notes; resolution checks the calling
  note's folder first, then the configured generator root.
- **Prompts** — generators that declare `Prompt:` controls render
  dropdowns or text inputs above the result. Change a value, re-roll
  with the new prompt set.
- **Stable seeds** — codeblocks can use a stable seed (off by default)
  so the same source at the same location produces the same roll on
  every render.
- **Generator browser pane** — sidebar tree of every `.ipt` file in your
  vault. Click to expand, click to roll, click 📋 to copy an inline
  `rdm:` reference (with the `Use:` line you'll need). Tree state
  persists across sessions. Open via the dice ribbon icon.
- **Existing `.ipt` files work as-is** — the engine survives the full
  AddCommas / Random-Treasure-CR1-CR30 stress test from the NBOS corpus.

## Install

### Via BRAT (recommended while in beta)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin
   if you don't have it.
2. Open BRAT settings → Add Beta Plugin → enter this repo's URL:
   `pjjelly17/RandomnessFrontmatter`
3. Enable "Randomness" under Community Plugins.

You can run this side-by-side with the original Randomness plugin — they
use different plugin IDs and don't collide.

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

Rolls one of the three on every render.

Full IPP3 grammar — multiple tables, weighted entries, prompts,
conditionals, dice, filters:

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

### Inline `rdm:` calls

Wrap an expression in backticks with the `rdm:` prefix:

```markdown
The shopkeeper, a `rdm:[@Names]` from `rdm:[@Origin]`, eyed me suspiciously.
```

Each call renders inline with a preview, plus 🔒 (lock) and 🎲 (re-roll)
buttons. Click 🔒 to rewrite the source with the chosen result:

```markdown
The shopkeeper, a `rdm:[@Names]⟹Tessith Vone` from `rdm:[@Origin]⟹Coppertown`,
eyed me suspiciously.
```

The lock survives everything — reloads, syncs, reopening the vault. Click
🎲 to strip the lock and show a fresh preview.

Inline scope sees same-note `randomness` codeblocks plus any `Use:`
declarations from those blocks, so keep table definitions next to the
prose that uses them.

### Sharing tables across notes

Stash shared tables in an `.ipt` file (e.g. `Generators/common-names.ipt`):

```
Table: Names
Tessith Vone
Korad the Blue
Mira Thornhaven
```

Reference from any note's codeblock:

````markdown
```randomness
Use:common-names.ipt
Table: NPC
{1d2=1, A man named, A woman named} [@Names].
```
````

`Use:` paths resolve relative to the current note's folder first, then
relative to the **Generator root** in Settings → Randomness.

### Commands

- **Lock all unfilled `rdm:` in current note** — evaluates every unfilled
  inline call, writes all locks in one atomic save.
- **Reroll all `rdm:` in current note** — strips every lock, clears cached
  previews.
- **Roll table into frontmatter property…** *(fork)* — pick a table, type
  a key, Enter. Result lands in frontmatter.
- **Quick roll table…** *(fork)* — fuzzy-pick, result via Notice + clipboard.
- **Open roll history** *(fork)* — sidebar view with reroll + mark-used
  per row.

## Public JS API

Stable surface at `app.plugins.plugins["randomness-frontmatter"].api`.
All methods return `Promise<RollResult>` (or variants); errors emit
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

### Core

- **Generator root** — vault-relative folder used as the fallback for
  `Use:` paths that don't resolve next to the calling note.
- **Default formatting** — `HTML (rich)` enables bold/italic/list filters as
  visual formatting; `Plain text` keeps them as plain characters. Individual
  generators can override via the `Formatting:` directive.
- **Stable codeblock seeds** — when on, codeblocks render the same result
  across reloads (until you reroll). Off by default.

### Session log *(fork)*

- **Auto-append rolls to active session note** — toggle (default OFF).
  When on, every successful roll appends a log line to the resolved session.
- **Session frontmatter key / value** — what identifies a session note.
  Defaults: `type` / `session`. Most-recent `date:` wins; ties broken by mtime.

### Roll history *(fork)*

- **Record roll history** — toggle (default ON). Persists every roll to
  `_rolls/history.md`.
- **History cap** — max entries (default 50; clamped 10–500). FIFO eviction.

### Used / Unused state *(fork)*

- **Auto-mark roll-into-property results as used** — toggle (default ON).
- **Exclude used when rolling into property** — toggle (default OFF). When
  on, the resolver re-rolls up to 20 attempts to find an unused result.

## Where inline `rdm:` calls work

Inline `rdm:` calls render in **Reading view** only. Obsidian's **Live
Preview** uses a different rendering pipeline (CodeMirror 6 extensions, not
markdown post-processors), and the plugin doesn't have a CM6 extension yet.

In Live Preview the inline calls show as plain code spans — locks in the
source survive, but the 🔒/🎲 buttons don't appear.

**Recommended workflow:** author prose in Live Preview, switch to Reading
view (Ctrl/Cmd-E) to roll/lock inline calls. Locks written from Reading view
show up in Live Preview's underlying source immediately.

Codeblock generators (`` ```randomness ``) work in both views — those use
the codeblock processor, which Live Preview does handle.

## Pending ideas

Phase 1 (v0.1.0) shipped the seven features above. What's on the bench:

- **Live Preview (CodeMirror 6) extension** — make inline `rdm:` calls
  render with 🔒/🎲 buttons in Live Preview too, not just Reading view.
  This is the highest-impact gap right now.
- **Mobile-friendly layout** — the sidebar history view + property modal
  aren't optimized for narrow screens yet. Phase 1 was desktop-first
  because it shipped against a real campaign vault; mobile is the next
  use case (camping / away-from-desk play).
- **Stake the Phase 2 scope** — open question. Candidates floating around:
  configurable `_rolls/` paths, per-note used/unused namespaces, history
  filtering by table or date, bulk-mark-used from history. Nothing
  committed.
- **Suggestions welcome.** Open an issue or PR. The fork's identity is
  DM-first, vault-data-first, and explicitly *no AI/LLM features* — keep
  proposals in that lane and they'll get a fair read.

## Attribution

This plugin is MIT-licensed (see [LICENSE](LICENSE)).

The IPP3 (Inspiration Pad Pro 3) grammar and file format are the work of
[NBOS Software](https://nbos.com). Their Inspiration Pad ecosystem is the
reason a generator written in 2008 still rolls today; this plugin aims to
be a faithful, modern execution environment for that work, not a replacement
for it. Use the original tools where they fit your workflow better — and
consider supporting NBOS.

Generator content (`.ipt` files) from the wider community remains the
copyright of its original authors and is governed by whatever licenses
those authors chose. The plugin does not include or distribute generator
content; the corpus shipped in the dev repo is for testing only.

## Architecture

Three layers:

- **Engine** (`src/engine/`) — pure IPP3 evaluator. AST, parsers, expression
  evaluator with seedable PRNG, 21 filters, recursion guard.
- **Resolver** (`src/resolver/`) — `Use:` graph traversal, markdown-codeblock
  extraction, inline scope assembly. Synchronous; async backend via
  `asyncPrefetcher`.
- **Views** (`src/views/`) — the only layer that imports Obsidian.
  Codeblock processor, inline processor, settings, lock/reroll state
  machine, prompt UI, HTML sanitiser, sidebar views.
