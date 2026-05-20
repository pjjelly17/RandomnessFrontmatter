/**
 * Plugin settings.
 *
 * Kept small on purpose: the engine and resolver are configurable
 * through their own options objects, and the plugin layer just maps
 * settings into those. Adding a setting means adding a field here, a
 * default, a UI control, and a wiring point in the consumer.
 *
 * The shape is plain data — no methods, no derived state — so it
 * survives loadData / saveData round-trips cleanly.
 */

import {
    App,
    PluginSettingTab,
    Setting,
    normalizePath,
} from "obsidian";
import type RandomnessPlugin from "./main";

export interface RandomnessSettings {
    /**
     * Vault-relative folder where shared generators live. `Use:` paths
     * that don't resolve against the current note's directory fall back
     * to here.
     *
     * Default empty — when empty, only relative-to-caller resolution
     * is attempted. Users with a shared `Generators/` folder will set
     * this once.
     */
    generatorRoot: string;
    /**
     * Default formatting mode for generators that don't specify one.
     * "html" lets bold/italic/underline filters emit HTML tags.
     * "text" makes them use plain-text approximations.
     * Per-file `Formatting:` directives override this.
     */
    defaultFormatting: "html" | "text";
    /**
     * Whether to use a stable seed (derived from codeblock position +
     * source hash) when rendering codeblocks. Off by default — each
     * render is independent. On is useful when you want a codeblock to
     * stay consistent across re-renders of the same note.
     *
     * The "Lock" action (next session) is a stronger guarantee; this
     * setting is for the in-between feel of "this codeblock shouldn't
     * shuffle every time I scroll past it".
     */
    stableCodeblockSeeds: boolean;
    /** When ON, every successful API roll appends a log line to the
     *  current session note (resolved by sessionTypeKey/sessionTypeValue).
     *  Default OFF — opt-in feature; silent no-op when no session note
     *  matches. */
    sessionAutoAppend: boolean;
    /** Frontmatter KEY that identifies a session note (e.g. "type"). */
    sessionTypeKey: string;
    /** Frontmatter VALUE that identifies a session note (e.g. "session"). */
    sessionTypeValue: string;
    /** Whether to record every roll attempt into the vault history file. Default ON. */
    historyEnabled: boolean;
    /** Max history entries to keep — FIFO eviction at this cap. Default 50. */
    historyMaxEntries: number;
    /**
     * Paths (folders and files) the user has expanded in the generator
     * browser pane. Persisted so the tree remembers its shape across
     * Obsidian reloads — start collapsed, expand what you use, the
     * choice survives.
     *
     * Plain array (not Set) so it round-trips cleanly through
     * loadData/saveData JSON. We treat it as a set in memory by
     * checking includes() / filter().
     */
    browserExpandedPaths: string[];
    /**
     * Tables the user has pinned as favourites. Each entry is a
     * stable identifier of the form `{filePath}::{tableName}` —
     * `::` chosen because vault paths can't contain it (`:` is
     * forbidden on Windows paths, but more importantly the double
     * colon is conspicuous enough that nobody would name a table
     * "x::y" by accident).
     *
     * Pinned tables appear in a "Favourites" section at the top of
     * the browser tree above all real folders. Order is insertion
     * order (oldest pinned at top) for stable mental model — users
     * pin things to find them later, and shuffling on every pin
     * would be disorienting.
     *
     * Array (not Set) for clean JSON round-tripping, same pattern
     * as `browserExpandedPaths`.
     */
    pinnedTables: string[];
}

const DEFAULT_SESSION_AUTO_APPEND = false;
const DEFAULT_SESSION_TYPE_KEY = "type";
const DEFAULT_SESSION_TYPE_VALUE = "session";
const DEFAULT_HISTORY_ENABLED = true;
const DEFAULT_HISTORY_MAX_ENTRIES = 50;

export const DEFAULT_SETTINGS: RandomnessSettings = {
    generatorRoot: "",
    defaultFormatting: "html",
    stableCodeblockSeeds: false,
    browserExpandedPaths: [],
    pinnedTables: [],
    // Session log auto-append fields. Plain enumerable properties so
    // loadSettings()'s Object.assign({}, DEFAULT_SETTINGS, stored) merge
    // includes them and persists user changes round-trip.
    sessionAutoAppend: DEFAULT_SESSION_AUTO_APPEND,
    sessionTypeKey: DEFAULT_SESSION_TYPE_KEY,
    sessionTypeValue: DEFAULT_SESSION_TYPE_VALUE,
    historyEnabled: DEFAULT_HISTORY_ENABLED,
    historyMaxEntries: DEFAULT_HISTORY_MAX_ENTRIES,
};

function clampHistoryMaxEntries(value: unknown): number {
    const parsedValue =
        typeof value === "number" ? value : Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsedValue)) {
        return DEFAULT_HISTORY_MAX_ENTRIES;
    }
    return Math.min(500, Math.max(10, Math.trunc(parsedValue)));
}

/**
 * Settings tab UI. The tab is registered by main.ts via
 * `addSettingTab`. When the user opens Settings → Randomness, Obsidian
 * calls `display()` to populate `containerEl`.
 *
 * Each setting writes through to plugin.settings and persists via
 * plugin.saveSettings(). No debouncing — the saveData backend already
 * coalesces writes, and these are settings the user changes rarely.
 */
export class RandomnessSettingsTab extends PluginSettingTab {
    plugin: RandomnessPlugin;

    constructor(app: App, plugin: RandomnessPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        // Clear with standard DOM methods so jsdom tests pass; Obsidian
        // augments HTMLElement with .empty(), but we don't need it.
        while (containerEl.firstChild) {
            containerEl.removeChild(containerEl.firstChild);
        }

        // Help & reference section, at the top so it's the first
        // thing users see when they open settings. The reference
        // covers all the table-authoring syntax — without
        // discoverability here, new users have to know about the
        // command palette entry to find it.
        new Setting(containerEl)
            .setName("Help & reference")
            .setDesc(
                "Open the in-app reference covering table syntax, " +
                    "filters, dice, conditionals, wiki-link rendering, " +
                    "and the codeblock/inline scoping rules."
            )
            .addButton((btn) =>
                btn
                    .setButtonText("Open reference")
                    .setCta()
                    .onClick(() => {
                        // Lazy import to avoid pulling the view module
                        // into the settings module's load graph — the
                        // view drags in MarkdownRenderer and the full
                        // reference text constant, which we don't need
                        // until the user actually clicks the button.
                        void import("./referenceView").then(
                            ({ openReferenceView }) =>
                                openReferenceView(this.plugin)
                        );
                    })
            );

        new Setting(containerEl)
            .setName("Generator root")
            .setDesc(
                "Vault-relative folder to search when a Use: path doesn't " +
                    "resolve against the note's own folder. Leave blank to " +
                    "only resolve relative to the calling note."
            )
            .addText((text) =>
                text
                    .setPlaceholder("Generators")
                    .setValue(this.plugin.settings.generatorRoot)
                    .onChange(async (value) => {
                        // Route the user's typed path through Obsidian's
                        // normalizePath — handles Unicode quirks, trims
                        // whitespace, normalises separators. Standard
                        // recommendation from the plugin review process.
                        // Empty input stays empty (means "no fallback").
                        const trimmed = value.trim();
                        this.plugin.settings.generatorRoot =
                            trimmed === "" ? "" : normalizePath(trimmed);
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Default formatting")
            .setDesc(
                "How bold/italic/underline filters render when a generator " +
                    "doesn't specify a Formatting: directive."
            )
            .addDropdown((dd) =>
                dd
                    .addOption("html", "HTML (rich)")
                    .addOption("text", "Plain text")
                    .setValue(this.plugin.settings.defaultFormatting)
                    .onChange(async (value) => {
                        this.plugin.settings.defaultFormatting =
                            value === "text" ? "text" : "html";
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Stable codeblock seeds")
            .setDesc(
                "When on, codeblocks render the same result across reloads " +
                    "until you reroll. When off, every render is independent. " +
                    "The Lock action (when available) is the stronger choice " +
                    "for preserving a specific result."
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.stableCodeblockSeeds)
                    .onChange(async (value) => {
                        this.plugin.settings.stableCodeblockSeeds = value;
                        await this.plugin.saveSettings();
                    })
            );

        // Plain DOM heading rather than `containerEl.createEl(...)` so the
        // test-suite's jsdom HTMLElement (which lacks Obsidian's createEl
        // augmentation) renders the settings tab without throwing.
        const sessionHeading = document.createElement("h3");
        sessionHeading.textContent = "Session log auto-append";
        containerEl.appendChild(sessionHeading);

        new Setting(containerEl)
            .setName("Auto-append rolls to active session note")
            .setDesc(
                "When on, every roll is appended as a one-line entry to the " +
                    "most-recent session note. Looks for notes whose " +
                    "frontmatter has the key/value below."
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(
                        this.plugin.settings.sessionAutoAppend ??
                            DEFAULT_SETTINGS.sessionAutoAppend
                    )
                    .onChange(async (value) => {
                        this.plugin.settings.sessionAutoAppend = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Session note frontmatter key")
            .setDesc("Frontmatter key that identifies a session note.")
            .addText((text) =>
                text
                    .setPlaceholder(DEFAULT_SESSION_TYPE_KEY)
                    .setValue(
                        this.plugin.settings.sessionTypeKey ??
                            DEFAULT_SETTINGS.sessionTypeKey
                    )
                    .onChange(async (value) => {
                        this.plugin.settings.sessionTypeKey = value.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Session note frontmatter value")
            .setDesc(
                "Frontmatter value at that key that marks a session note."
            )
            .addText((text) =>
                text
                    .setPlaceholder(DEFAULT_SESSION_TYPE_VALUE)
                    .setValue(
                        this.plugin.settings.sessionTypeValue ??
                            DEFAULT_SETTINGS.sessionTypeValue
                    )
                    .onChange(async (value) => {
                        this.plugin.settings.sessionTypeValue = value.trim();
                        await this.plugin.saveSettings();
                    })
            );

        const historyHeading = document.createElement("h3");
        historyHeading.textContent = "Roll history";
        containerEl.appendChild(historyHeading);

        new Setting(containerEl)
            .setName("Record roll history")
            .setDesc(
                "Record every roll into _rolls/history.jsonl in the vault. Disable for a no-trace mode."
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(
                        this.plugin.settings.historyEnabled ??
                            DEFAULT_SETTINGS.historyEnabled
                    )
                    .onChange(async (value) => {
                        this.plugin.settings.historyEnabled = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Maximum history entries")
            .setDesc("Maximum history entries (oldest dropped when full).")
            .addText((text) =>
                text
                    .setPlaceholder(String(DEFAULT_HISTORY_MAX_ENTRIES))
                    .setValue(
                        String(
                            this.plugin.settings.historyMaxEntries ??
                                DEFAULT_SETTINGS.historyMaxEntries
                        )
                    )
                    .onChange(async (value) => {
                        this.plugin.settings.historyMaxEntries =
                            clampHistoryMaxEntries(value);
                        await this.plugin.saveSettings();
                    })
            );
    }
}

/**
 * Compute a stable seed for a given codeblock source + position.
 * Used when `stableCodeblockSeeds` is on. The hash function is FNV-1a
 * because it's tiny and good enough for variance — not for security.
 *
 * `position` here is the codeblock's lineStart from the post-processor
 * context; combining with the source ensures that two identical
 * codeblocks at different positions get different seeds.
 */
export function stableSeedFor(source: string, position: number): number {
    // FNV-1a 32-bit
    let h = 0x811c9dc5;
    for (let i = 0; i < source.length; i++) {
        h ^= source.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    h ^= position;
    h = Math.imul(h, 0x01000193);
    // Force positive 32-bit integer
    return h >>> 0;
}
