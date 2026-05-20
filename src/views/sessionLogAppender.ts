import { TFile } from "obsidian";
import type { RollResult } from "../api";
import type RandomnessPlugin from "./main";
import { DEFAULT_SETTINGS } from "./settings";

type FrontmatterLike = Record<string, unknown>;

const appendQueues = new WeakMap<RandomnessPlugin, Promise<void>>();

interface SessionCandidate {
    file: TFile;
    primarySortMs: number;
    mtimeMs: number;
}

function sessionAutoAppendEnabled(plugin: RandomnessPlugin): boolean {
    return plugin.settings.sessionAutoAppend ?? DEFAULT_SETTINGS.sessionAutoAppend;
}

function sessionTypeKey(plugin: RandomnessPlugin): string {
    return (
        plugin.settings.sessionTypeKey ?? DEFAULT_SETTINGS.sessionTypeKey
    ).trim();
}

function sessionTypeValue(plugin: RandomnessPlugin): string {
    return (
        plugin.settings.sessionTypeValue ?? DEFAULT_SETTINGS.sessionTypeValue
    ).trim();
}

function asFrontmatterLike(value: unknown): FrontmatterLike | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value as FrontmatterLike;
}

function resolvePrimarySortMs(
    frontmatter: FrontmatterLike,
    file: TFile
): number {
    const rawDate = frontmatter["date"];
    if (rawDate === undefined || rawDate === null) {
        return file.stat.mtime;
    }

    const parsedDate = new Date(String(rawDate));
    const parsedMs = parsedDate.getTime();
    return Number.isFinite(parsedMs) ? parsedMs : Number.NEGATIVE_INFINITY;
}

function compareSessionCandidates(
    left: SessionCandidate,
    right: SessionCandidate
): number {
    if (left.primarySortMs !== right.primarySortMs) {
        return right.primarySortMs - left.primarySortMs;
    }
    return right.mtimeMs - left.mtimeMs;
}

function formatRollTime(timestamp: string): string {
    const parsedDate = new Date(timestamp);
    const parsedMs = parsedDate.getTime();
    if (!Number.isFinite(parsedMs)) {
        throw new Error(`Invalid roll timestamp: ${timestamp}`);
    }
    const hours = String(parsedDate.getHours()).padStart(2, "0");
    const minutes = String(parsedDate.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
}

function buildRollLogLine(rollResult: RollResult): string {
    if (typeof rollResult.table !== "string") {
        throw new Error("Roll result table must be a string");
    }
    if (typeof rollResult.result !== "string") {
        throw new Error("Roll result result must be a string");
    }
    if (typeof rollResult.timestamp !== "string") {
        throw new Error("Roll result timestamp must be a string");
    }

    const timeText = formatRollTime(rollResult.timestamp);
    return `- ${timeText} rolled ${rollResult.table}: ${rollResult.result}`;
}

/**
 * Resolve the most-recent session note in the vault by frontmatter
 * match (key === value) sorted by frontmatter.date DESC then
 * file.stat.mtime DESC. Returns null if no match.
 */
export function resolveSessionNote(plugin: RandomnessPlugin): TFile | null {
    const key = sessionTypeKey(plugin);
    const value = sessionTypeValue(plugin);
    if (key === "" || value === "") {
        return null;
    }

    const metadataCache = plugin.app.metadataCache;
    if (
        !metadataCache ||
        typeof metadataCache.getFileCache !== "function"
    ) {
        return null;
    }

    const candidates: SessionCandidate[] = [];
    for (const file of plugin.app.vault.getMarkdownFiles()) {
        if (!(file instanceof TFile)) {
            continue;
        }

        const fileCache = metadataCache.getFileCache(file);
        const frontmatter = asFrontmatterLike(
            fileCache && typeof fileCache === "object"
                ? (fileCache as { frontmatter?: unknown }).frontmatter
                : null
        );
        if (!frontmatter || frontmatter[key] !== value) {
            continue;
        }

        candidates.push({
            file,
            primarySortMs: resolvePrimarySortMs(frontmatter, file),
            mtimeMs: file.stat.mtime,
        });
    }

    candidates.sort(compareSessionCandidates);
    return candidates[0]?.file ?? null;
}

async function appendRollLine(
    plugin: RandomnessPlugin,
    note: TFile,
    rollResult: RollResult
): Promise<void> {
    try {
        // Vault reads/writes intentionally await Obsidian's I/O without a
        // local timeout wrapper: the adapter API is not cancellable, and a
        // timeout would not stop the underlying work. Failures still surface
        // here with context via the catch below.
        const source = await plugin.app.vault.read(note);
        if (typeof source !== "string") {
            throw new Error(`vault.read returned non-string for "${note.path}"`);
        }

        const line = buildRollLogLine(rollResult);
        const newSource =
            source + (source.endsWith("\n") ? "" : "\n") + line + "\n";
        await plugin.app.vault.modify(note, newSource);
    } catch (error: unknown) {
        console.warn(
            "randomness-frontmatter: session log append failed",
            error
        );
    }
}

/**
 * Append a roll log line to the resolved session note. Silent no-op
 * if no session note matches or if the feature is disabled in
 * settings. Errors are caught + console.warn-logged; never throws.
 */
export async function appendRollToSessionNote(
    plugin: RandomnessPlugin,
    rollResult: RollResult
): Promise<void> {
    if (!sessionAutoAppendEnabled(plugin)) {
        return;
    }

    const note = resolveSessionNote(plugin);
    if (!note) {
        return;
    }

    // Multiple roll events can arrive back-to-back; serialize the
    // read-modify-write so one append cannot overwrite another.
    const previousAppend = appendQueues.get(plugin) ?? Promise.resolve();
    const appendPromise = previousAppend
        .catch(() => {
            // Prior failures are already logged by appendRollLine; keep the
            // queue moving for later rolls.
        })
        .then(async () => appendRollLine(plugin, note, rollResult));
    appendQueues.set(plugin, appendPromise);

    await appendPromise;
    if (appendQueues.get(plugin) === appendPromise) {
        appendQueues.delete(plugin);
    }
}
