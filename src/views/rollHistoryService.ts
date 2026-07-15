import type { RollResult } from "../api";
import type RandomnessPlugin from "./main";
import { DEFAULT_SETTINGS } from "./settings";

export interface HistoryEntry {
    rollId: string;
    table: string;
    result: string;
    expression: string;
    timestamp: string;
    sourcePath: string;
    /** Present only when this entry represents a failed roll. */
    error?: string;
}

/**
 * Canonical history file. Stored as markdown (not JSONL) so PJ can
 * open it inside Obsidian and skim the roll log without bouncing to
 * an external text editor. Machine-readable bits (rollId / sourcePath
 * / timestamp / table / error) live in a per-line HTML comment so
 * loadRollHistory can round-trip cleanly while the human view stays
 * a clean bulleted list.
 */
export const HISTORY_FILE_PATH = "_rolls/history.md";

/** Pre-2026-05-20 location. Read once at first load, then deleted. */
const LEGACY_HISTORY_FILE_PATH = "_rolls/history.jsonl";

const HISTORY_FOLDER_PATH = "_rolls";

/**
 * Regex matching one history line. Anchored to a full line.
 *   group 1 — optional failure marker "❌ "
 *   group 2 — formatted timestamp (display only; truth is in the comment)
 *   group 3 — expression (e.g. `[@Plant]`)
 *   group 4 — result text (single line; newlines are escaped on write)
 *   group 5 — JSON metadata blob
 */
const HISTORY_LINE_RE =
    /^- (❌ )?`([^`]+)` · `([^`]+)` → (.+?) <!-- randomness-history: ({.+}) -->$/;

const FILE_HEADER = "# Roll History\n\n";

const appendQueues = new WeakMap<RandomnessPlugin, Promise<void>>();

function historyEnabled(plugin: RandomnessPlugin): boolean {
    return plugin.settings.historyEnabled ?? DEFAULT_SETTINGS.historyEnabled;
}

function historyMaxEntries(plugin: RandomnessPlugin): number {
    const rawValue =
        plugin.settings.historyMaxEntries ??
        DEFAULT_SETTINGS.historyMaxEntries;
    if (!Number.isFinite(rawValue)) {
        return DEFAULT_SETTINGS.historyMaxEntries;
    }
    return Math.min(500, Math.max(10, Math.trunc(rawValue)));
}

function buildHistoryEntry(result: RollResult): HistoryEntry {
    return {
        rollId: result.rollId,
        table: result.table,
        result: result.result,
        expression: result.expression,
        timestamp: result.timestamp,
        sourcePath: result.source ?? "",
        ...(result.error ? { error: result.error } : {}),
    };
}

function formatDisplayTimestamp(iso: string): string {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) {
        return iso;
    }
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${mm}/${dd}/${yyyy} ${hh}:${min}`;
}

function escapeForMarkdownLine(text: string): string {
    // Newlines would shatter the per-line regex; preserve them as a
    // literal escape sequence so round-trip stays exact.
    return text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

function unescapeFromMarkdownLine(text: string): string {
    return text.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\\\/g, "\\");
}

function serializeEntry(entry: HistoryEntry): string {
    const displayTs = formatDisplayTimestamp(entry.timestamp);
    const failureMark = entry.error ? "❌ " : "";
    const resultText = escapeForMarkdownLine(entry.result);
    const meta = {
        rollId: entry.rollId,
        table: entry.table,
        timestamp: entry.timestamp,
        sourcePath: entry.sourcePath,
        ...(entry.error ? { error: entry.error } : {}),
    };
    return (
        `- ${failureMark}\`${displayTs}\` · \`${entry.expression}\` → ` +
        `${resultText} <!-- randomness-history: ${JSON.stringify(meta)} -->`
    );
}

function parseEntry(line: string): HistoryEntry | null {
    const m = HISTORY_LINE_RE.exec(line);
    if (!m) return null;
    const expression = m[3];
    const result = unescapeFromMarkdownLine(m[4]);
    let meta: {
        rollId?: string;
        table?: string;
        timestamp?: string;
        sourcePath?: string;
        error?: string;
    };
    try {
        meta = JSON.parse(m[5]);
    } catch {
        return null;
    }
    if (
        typeof meta.rollId !== "string" ||
        typeof meta.table !== "string" ||
        typeof meta.timestamp !== "string" ||
        typeof meta.sourcePath !== "string"
    ) {
        return null;
    }
    const entry: HistoryEntry = {
        rollId: meta.rollId,
        table: meta.table,
        result,
        expression,
        timestamp: meta.timestamp,
        sourcePath: meta.sourcePath,
    };
    if (meta.error !== undefined) {
        entry.error = meta.error;
    }
    return entry;
}

function serializeAllEntries(entries: HistoryEntry[]): string {
    if (entries.length === 0) {
        return FILE_HEADER;
    }
    return FILE_HEADER + entries.map(serializeEntry).join("\n") + "\n";
}

async function ensureHistoryFolder(
    plugin: RandomnessPlugin
): Promise<void> {
    try {
        if (await plugin.app.vault.adapter.exists(HISTORY_FOLDER_PATH)) {
            return;
        }
        if (typeof plugin.app.vault.createFolder !== "function") {
            return;
        }
        try {
            await plugin.app.vault.createFolder(HISTORY_FOLDER_PATH);
        } catch (error: unknown) {
            const message =
                error instanceof Error ? error.message : String(error);
            if (!message.toLowerCase().includes("already exists")) {
                console.warn(
                    "randomness-frontmatter: failed to create history folder",
                    error
                );
            }
        }
    } catch (error: unknown) {
        console.warn(
            "randomness-frontmatter: failed to ensure history folder",
            error
        );
    }
}

/**
 * One-shot migration: when the markdown file is missing but the
 * legacy JSONL file exists, read the JSONL, write the markdown, and
 * remove the old file. Runs inside loadRollHistory so it happens
 * lazily on the first access after upgrade.
 */
async function migrateLegacyHistoryIfNeeded(
    plugin: RandomnessPlugin
): Promise<HistoryEntry[] | null> {
    const adapter = plugin.app.vault.adapter;
    try {
        if (await adapter.exists(HISTORY_FILE_PATH)) {
            return null;
        }
        if (!(await adapter.exists(LEGACY_HISTORY_FILE_PATH))) {
            return null;
        }
        const legacySource = await adapter.read(LEGACY_HISTORY_FILE_PATH);
        const entries: HistoryEntry[] = [];
        for (const line of legacySource.split("\n")) {
            const trimmed = line.trim();
            if (trimmed === "") continue;
            try {
                entries.push(JSON.parse(trimmed) as HistoryEntry);
            } catch (error: unknown) {
                console.warn(
                    "randomness-frontmatter: legacy history line dropped",
                    error
                );
            }
        }
        await ensureHistoryFolder(plugin);
        await adapter.write(HISTORY_FILE_PATH, serializeAllEntries(entries));
        try {
            await adapter.remove(LEGACY_HISTORY_FILE_PATH);
        } catch (error: unknown) {
            // Non-fatal — the markdown file is the new source of
            // truth; the legacy file will just sit there harmlessly.
            console.warn(
                "randomness-frontmatter: failed to remove legacy history file",
                error
            );
        }
        return entries;
    } catch (error: unknown) {
        console.warn(
            "randomness-frontmatter: legacy history migration failed",
            error
        );
        return null;
    }
}

async function appendHistoryEntry(
    plugin: RandomnessPlugin,
    result: RollResult
): Promise<void> {
    try {
        const entries = await loadRollHistory(plugin);
        const nextEntry = buildHistoryEntry(result);
        const latestEntry = entries[entries.length - 1];
        if (latestEntry?.rollId === nextEntry.rollId) {
            return;
        }
        entries.push(nextEntry);
        const maxEntries = historyMaxEntries(plugin);
        if (entries.length > maxEntries) {
            entries.splice(0, entries.length - maxEntries);
        }
        await ensureHistoryFolder(plugin);
        await plugin.app.vault.adapter.write(
            HISTORY_FILE_PATH,
            serializeAllEntries(entries)
        );
    } catch (error: unknown) {
        console.warn(
            "randomness-frontmatter: roll history append failed",
            error
        );
    }
}

/** Append a roll result to history. Bail-fast on toggle off; FIFO-evict at cap. Silent on errors. */
export async function appendRollToHistory(
    plugin: RandomnessPlugin,
    result: RollResult
): Promise<void> {
    if (!historyEnabled(plugin)) {
        return;
    }

    const previousAppend = appendQueues.get(plugin) ?? Promise.resolve();
    const appendPromise = previousAppend
        .catch(() => {
            // Prior failures are already logged; keep the queue moving so a
            // single bad write does not stall every later roll.
        })
        .then(async () => appendHistoryEntry(plugin, result));
    appendQueues.set(plugin, appendPromise);

    await appendPromise;
    if (appendQueues.get(plugin) === appendPromise) {
        appendQueues.delete(plugin);
    }
}

/** Load all history entries. Returns oldest-first. Empty array if file missing or unparseable. */
export async function loadRollHistory(
    plugin: RandomnessPlugin
): Promise<HistoryEntry[]> {
    const migrated = await migrateLegacyHistoryIfNeeded(plugin);
    if (migrated !== null) {
        return migrated;
    }

    const parsedEntries: HistoryEntry[] = [];
    try {
        if (!(await plugin.app.vault.adapter.exists(HISTORY_FILE_PATH))) {
            return [];
        }
        const source = await plugin.app.vault.adapter.read(HISTORY_FILE_PATH);
        const lines = source.split("\n");
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === "" || trimmed.startsWith("#")) continue;
            const entry = parseEntry(trimmed);
            if (entry === null) {
                console.warn(
                    "randomness-frontmatter: skipping unparseable history line",
                    trimmed
                );
                continue;
            }
            parsedEntries.push(entry);
        }
    } catch (error: unknown) {
        console.warn(
            "randomness-frontmatter: roll history load failed",
            error
        );
    }

    return parsedEntries;
}

/**
 * Rerolling from the sidebar needs the queued append to finish before the
 * view reloads, otherwise the freshly emitted roll can miss the first
 * refresh because the `onRoll` side-effect is still writing.
 */
export async function waitForRollHistoryWrites(
    plugin: RandomnessPlugin
): Promise<void> {
    const pendingAppend = appendQueues.get(plugin);
    if (!pendingAppend) {
        return;
    }
    await pendingAppend.catch(() => {});
}
