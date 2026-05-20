import type RandomnessPlugin from "./main";

/** Vault-global used-result entry persisted in `_rolls/used.md`. */
export interface UsedEntry {
    /** Stable key: lowercased table|result */
    key: string;
    table: string;
    result: string;
    /** ISO 8601 timestamp of when the entry was marked used. */
    markedAt: string;
}

/** Canonical markdown file that stores the vault-global used set. */
export const USED_FILE_PATH = "_rolls/used.md";

const USED_FOLDER_PATH = "_rolls";
const USED_FILE_HEADER = "# Used Roll Results\n\n";

/**
 * Regex matching one used-result line. Anchored to a full line.
 *   group 1 — table name from the rendered markdown
 *   group 2 — result text (escaped to stay single-line on disk)
 *   group 3 — JSON metadata blob
 */
const USED_LINE_RE =
    /^- `\[@([^\]]+)\]` → (.+?) <!-- randomness-used: ({.+}) -->$/;

const writeQueues = new WeakMap<RandomnessPlugin, Promise<void>>();

interface UsedEntryMeta {
    key: string;
    markedAt: string;
}

/**
 * Compute the dedup key for a (table, result) pair as
 * `${table.trim().toLowerCase()}|${result.trim().toLowerCase()}`.
 */
export function usedKeyFor(table: string, result: string): string {
    return `${table.trim().toLowerCase()}|${result.trim().toLowerCase()}`;
}

function escapeForMarkdownLine(text: string): string {
    return text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

function unescapeFromMarkdownLine(text: string): string {
    return text.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\\\/g, "\\");
}

function isUsedEntryMeta(value: unknown): value is UsedEntryMeta {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }

    const meta = value as Record<string, unknown>;
    return (
        typeof meta.key === "string" &&
        typeof meta.markedAt === "string"
    );
}

function serializeEntry(entry: UsedEntry): string {
    const meta: UsedEntryMeta = {
        key: entry.key,
        markedAt: entry.markedAt,
    };
    return (
        `- \`[@${entry.table}]\` → ${escapeForMarkdownLine(entry.result)}` +
        ` <!-- randomness-used: ${JSON.stringify(meta)} -->`
    );
}

function parseEntry(line: string): UsedEntry | null {
    const match = USED_LINE_RE.exec(line);
    if (!match) {
        return null;
    }

    let meta: unknown;
    try {
        meta = JSON.parse(match[3]);
    } catch {
        return null;
    }
    if (!isUsedEntryMeta(meta)) {
        return null;
    }

    const table = match[1];
    const result = unescapeFromMarkdownLine(match[2]);
    if (meta.key !== usedKeyFor(table, result)) {
        return null;
    }

    return {
        key: meta.key,
        table,
        result,
        markedAt: meta.markedAt,
    };
}

function serializeAllEntries(entries: UsedEntry[]): string {
    if (entries.length === 0) {
        return USED_FILE_HEADER;
    }
    return USED_FILE_HEADER + entries.map(serializeEntry).join("\n") + "\n";
}

async function ensureUsedFolder(
    plugin: RandomnessPlugin
): Promise<void> {
    try {
        if (await plugin.app.vault.adapter.exists(USED_FOLDER_PATH)) {
            return;
        }
        if (typeof plugin.app.vault.createFolder !== "function") {
            return;
        }
        try {
            await plugin.app.vault.createFolder(USED_FOLDER_PATH);
        } catch (error: unknown) {
            const message =
                error instanceof Error ? error.message : String(error);
            if (!message.toLowerCase().includes("already exists")) {
                console.warn(
                    "randomness-frontmatter: failed to create used folder",
                    error
                );
            }
        }
    } catch (error: unknown) {
        console.warn(
            "randomness-frontmatter: failed to ensure used folder",
            error
        );
    }
}

async function queueUsedWrite(
    plugin: RandomnessPlugin,
    operation: () => Promise<void>
): Promise<void> {
    const previousWrite = writeQueues.get(plugin) ?? Promise.resolve();
    const writePromise = previousWrite
        .catch(() => {
            // Prior failures are already logged; keep the queue moving so one
            // bad write does not block later mark/unmark operations.
        })
        .then(operation);
    writeQueues.set(plugin, writePromise);

    try {
        await writePromise;
    } finally {
        if (writeQueues.get(plugin) === writePromise) {
            writeQueues.delete(plugin);
        }
    }
}

/** Load all used entries. Empty array if file missing or unparseable. */
export async function loadUsed(
    plugin: RandomnessPlugin
): Promise<UsedEntry[]> {
    try {
        if (!(await plugin.app.vault.adapter.exists(USED_FILE_PATH))) {
            return [];
        }

        const source = await plugin.app.vault.adapter.read(USED_FILE_PATH);
        const entries: UsedEntry[] = [];
        for (const line of source.split("\n")) {
            const trimmed = line.trim();
            if (trimmed === "" || trimmed.startsWith("#")) {
                continue;
            }

            const entry = parseEntry(trimmed);
            if (entry === null) {
                console.warn(
                    "randomness-frontmatter: skipping unparseable used line",
                    trimmed
                );
                continue;
            }
            entries.push(entry);
        }

        return entries;
    } catch (error: unknown) {
        console.warn(
            "randomness-frontmatter: used state load failed",
            error
        );
        return [];
    }
}

/** True if (table, result) is in the used set. */
export async function isUsed(
    plugin: RandomnessPlugin,
    table: string,
    result: string
): Promise<boolean> {
    try {
        const key = usedKeyFor(table, result);
        const entries = await loadUsed(plugin);
        return entries.some((entry) => entry.key === key);
    } catch (error: unknown) {
        console.warn(
            "randomness-frontmatter: used state lookup failed",
            error
        );
        return false;
    }
}

/** Append (idempotent — silently no-ops if key already present). */
export async function markUsed(
    plugin: RandomnessPlugin,
    table: string,
    result: string
): Promise<void> {
    const key = usedKeyFor(table, result);
    try {
        await queueUsedWrite(plugin, async () => {
            const entries = await loadUsed(plugin);
            if (entries.some((entry) => entry.key === key)) {
                return;
            }

            entries.push({
                key,
                table,
                result,
                markedAt: new Date().toISOString(),
            });
            await ensureUsedFolder(plugin);
            await plugin.app.vault.adapter.write(
                USED_FILE_PATH,
                serializeAllEntries(entries)
            );
        });
    } catch (error: unknown) {
        console.warn(
            "randomness-frontmatter: mark used failed",
            error
        );
    }
}

/** Remove the entry. Silent no-op if key not present. */
export async function unmarkUsed(
    plugin: RandomnessPlugin,
    table: string,
    result: string
): Promise<void> {
    const key = usedKeyFor(table, result);
    try {
        await queueUsedWrite(plugin, async () => {
            const entries = await loadUsed(plugin);
            if (!entries.some((entry) => entry.key === key)) {
                return;
            }

            const remainingEntries = entries.filter(
                (entry) => entry.key !== key
            );
            await ensureUsedFolder(plugin);
            await plugin.app.vault.adapter.write(
                USED_FILE_PATH,
                serializeAllEntries(remainingEntries)
            );
        });
    } catch (error: unknown) {
        console.warn(
            "randomness-frontmatter: unmark used failed",
            error
        );
    }
}
