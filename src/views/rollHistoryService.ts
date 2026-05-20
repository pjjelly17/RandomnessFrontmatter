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

export const HISTORY_FILE_PATH = "_rolls/history.jsonl";
const HISTORY_FOLDER_PATH = "_rolls";

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

async function ensureHistoryFolder(
    plugin: RandomnessPlugin
): Promise<void> {
    try {
        if (await plugin.app.vault.adapter.exists(HISTORY_FOLDER_PATH)) {
            return;
        }
        if (typeof plugin.app.vault.createFolder !== "function") {
            // The adapter write may still succeed in tests or on adapters
            // that materialise parent paths implicitly, so there is nothing
            // useful to do here beyond skipping the unavailable API.
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
        const content =
            entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
        await ensureHistoryFolder(plugin);
        await plugin.app.vault.adapter.write(HISTORY_FILE_PATH, content);
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
    const parsedEntries: HistoryEntry[] = [];

    try {
        if (!(await plugin.app.vault.adapter.exists(HISTORY_FILE_PATH))) {
            return [];
        }
        const source = await plugin.app.vault.adapter.read(HISTORY_FILE_PATH);
        const lines = source.split("\n").filter((line) => line.trim() !== "");
        for (const line of lines) {
            try {
                parsedEntries.push(JSON.parse(line) as HistoryEntry);
            } catch (error: unknown) {
                console.warn(
                    "randomness-frontmatter: skipping invalid roll history line",
                    error
                );
            }
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
    await pendingAppend.catch(() => {
        // Append failures are already logged by the write path; callers only
        // need the queue to settle before they refresh their UI.
    });
}
