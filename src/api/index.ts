/**
 * Public JS API surface for randomness-frontmatter v0.1.
 */

import { TFile } from "obsidian";
import { parseGeneratorFile } from "../engine/fileParser";
import { evaluateInlineExpression } from "../views/inlineProcessor";
import { buildInlineBundle } from "../resolver/scope";
import { prefetchUseGraph } from "../resolver/asyncPrefetcher";
import { vaultFileSource } from "../views/vaultFileSource";
import { discoverGenerators } from "../views/browserView";
import { collectTablesFromBundle } from "../views/tableAutocomplete";
import type RandomnessPlugin from "../views/main";

const API_VERSION = "0.1.0" as const;
const REQUESTED_TABLE = Symbol("requestedTable");

export interface RollOptions {
    /** Path of the note initiating the roll. Defaults to the active file's path. Resolves Use: paths and frontmatter context. */
    callerNotePath?: string;
    /** Seed for deterministic roll. Accepted for v0.1 compatibility but currently a no-op because evaluateInlineExpression does not accept a seed. */
    seed?: number;
    /** Override prompt values for Prompt: directives. Accepted for v0.1 compatibility but currently a no-op because evaluateInlineExpression does not accept prompt overrides. */
    promptValues?: Record<string, string>;
}

/** Result emitted for every roll attempt. Successful rolls omit `error`; failure emits set it and use `result` as the error marker text. */
export interface RollResult {
    /** The final rendered text. */
    result: string;
    /** The table name that was rolled (as requested). */
    table: string;
    /** The full expression that was evaluated (e.g. "[@Faction]"). */
    expression: string;
    /** Source file the table was resolved from, if known. Left undefined in v0.1 because the engine does not expose the resolved .ipt path. */
    source?: string;
    /** Present and set to the failure message ONLY when this result represents a roll attempt that threw inside the evaluator. Absent on successful rolls. */
    error?: string;
    /** ISO 8601 timestamp of when the roll happened. */
    timestamp: string;
    /** Unique roll ID (crypto.randomUUID() or similar). Stable across the process; useful for history dedup. */
    rollId: string;
}

export type RollEventListener = (result: RollResult) => void;

export interface TableSource {
    /** Table identifier as it appears after `Table:` */
    name: string;
    /** Human-readable origin label, e.g. "(this note)", "Herbs.ipt", "6 - Tables/Herbs.ipt" */
    source: string;
    /** True for the file's first/main table */
    isMain: boolean;
    /** True if this table is reachable from the caller note's Use: graph */
    inScope: boolean;
    /** Vault-relative path of the .ipt file. Empty string for tables defined inside the note's own codeblock. */
    filePath: string;
}

export interface RandomnessFrontmatterAPI {
    readonly version: string;
    /** Wraps the requested table name as [@name]; names that need IPP3 escaping must already be passed in parser-safe form. */
    roll(tableName: string, opts?: RollOptions): Promise<RollResult>;
    /**
     * Roll a table referenced by its name + the vault-relative path of
     * the .ipt file that defines it. Bypasses the caller note's Use:
     * graph by evaluating against a synthetic note source that imports
     * only that file, and fires onRoll listeners just like roll().
     *
     * Throws if the file doesn't exist, doesn't parse, or doesn't define
     * a table by that name.
     */
    rollUnscoped(
        tableName: string,
        filePath: string
    ): Promise<RollResult>;
    rollExpression(rawExpr: string, opts?: RollOptions): Promise<RollResult>;
    rollIntoProperty(
        key: string,
        tableName: string,
        opts?: RollOptions
    ): Promise<RollResult>;
    /** Accepts callerNotePath for future scope-aware listing, but v0.1 returns the full vault-wide .ipt table list either way. */
    tables(callerNotePath?: string): Promise<string[]>;
    /**
     * Scope-aware table listing: in-scope tables (reachable from
     * the caller note's Use: graph) first, then out-of-scope
     * (vault-wide). Used by the "Roll into property" command's
     * SuggestModal to surface non-imported tables with an
     * indicator that the caller will inject a Use: line before
     * rolling them.
     */
    tablesWithSources(callerNotePath?: string): Promise<TableSource[]>;
    onRoll(callback: RollEventListener): () => void;
}

type InternalRollOptions = RollOptions & {
    [REQUESTED_TABLE]?: string;
};

export function createApi(
    plugin: RandomnessPlugin
): RandomnessFrontmatterAPI {
    const listeners = new Set<RollEventListener>();

    const emitRoll = (result: RollResult): void => {
        for (const listener of listeners) {
            try {
                listener(result);
            } catch (error: unknown) {
                console.error(
                    "randomness-frontmatter: roll listener threw",
                    error
                );
            }
        }
    };

    const emitFailureResult = (
        expression: string,
        table: string,
        error: unknown
    ): RollResult => {
        const message =
            error instanceof Error ? error.message : String(error);
        const result: RollResult = {
            result: `[ROLL ERROR: ${message}]`,
            table,
            expression,
            source: undefined,
            error: message,
            timestamp: new Date().toISOString(),
            rollId: globalThis.crypto.randomUUID(),
        };
        emitRoll(result);
        return result;
    };

    const rollExpression = async (
        rawExpr: string,
        opts?: RollOptions
    ): Promise<RollResult> => {
        const notePath = resolveCallerNotePath(plugin, opts);
        const table =
            (opts as InternalRollOptions | undefined)?.[
                REQUESTED_TABLE
            ] ?? rawExpr;
        try {
            const resultText = await evaluateInlineExpression(
                rawExpr,
                notePath,
                plugin
            );
            const result: RollResult = {
                result: resultText,
                table,
                expression: rawExpr,
                source: undefined,
                timestamp: new Date().toISOString(),
                rollId: globalThis.crypto.randomUUID(),
            };
            emitRoll(result);
            return result;
        } catch (error: unknown) {
            emitFailureResult(rawExpr, table, error);
            throw error;
        }
    };

    const roll = async (
        tableName: string,
        opts?: RollOptions
    ): Promise<RollResult> => {
        const expression = `[@${tableName}]`;
        const internalOpts: InternalRollOptions = {
            ...(opts ?? {}),
            [REQUESTED_TABLE]: tableName,
        };
        return rollExpression(expression, internalOpts);
    };

    const rollUnscoped = async (
        tableName: string,
        filePath: string
    ): Promise<RollResult> => {
        const expression = `[@${tableName}]`;
        const file = plugin.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) {
            const error = new Error(
                `Table file "${filePath}" does not exist in the vault`
            );
            emitFailureResult(expression, tableName, error);
            throw error;
        }

        let source: string;
        try {
            source = await plugin.app.vault.read(file);
        } catch (error: unknown) {
            const readError = new Error(
                `Failed to read table file "${filePath}": ${errorMessage(error)}`
            );
            emitFailureResult(expression, tableName, readError);
            throw readError;
        }

        let parsed: ReturnType<typeof parseGeneratorFile>;
        try {
            parsed = parseGeneratorFile(source);
        } catch (error: unknown) {
            const parseError = new Error(
                `Failed to parse table file "${filePath}": ${errorMessage(error)}`
            );
            emitFailureResult(expression, tableName, parseError);
            throw parseError;
        }

        if (!parsed.tables.some((table) => table.name === tableName)) {
            const error = new Error(
                `Table "${tableName}" was not found in "${filePath}"`
            );
            emitFailureResult(expression, tableName, error);
            throw error;
        }

        const syntheticSource = `\`\`\`randomness\nUse: ${filePath}\n\`\`\``;
        // Colon-prefixed sentinel marks this as synthetic context, not a
        // real vault path, while still carrying the imported file for logs.
        const syntheticNotePath = `__quick_roll__:${filePath}`;
        let resultText: string;
        try {
            resultText = await evaluateInlineExpression(
                expression,
                syntheticNotePath,
                plugin,
                syntheticSource
            );
        } catch (error: unknown) {
            emitFailureResult(expression, tableName, error);
            throw error;
        }
        const result: RollResult = {
            result: resultText,
            table: tableName,
            expression,
            source: undefined,
            timestamp: new Date().toISOString(),
            rollId: globalThis.crypto.randomUUID(),
        };
        emitRoll(result);
        return result;
    };

    return {
        version: API_VERSION,
        roll,
        rollUnscoped,
        rollExpression,
        async rollIntoProperty(
            key: string,
            tableName: string,
            opts?: RollOptions
        ): Promise<RollResult> {
            const file = plugin.app.workspace.getActiveFile();
            if (!(file instanceof TFile)) {
                throw new Error("No active file to write frontmatter to");
            }

            const result = await roll(tableName, opts);
            await plugin.app.fileManager.processFrontMatter(file, (fm) => {
                fm[key] = result.result;
            });
            return result;
        },
        // Use a direct vault scan here so the API stays decoupled from the editor autocomplete cache.
        async tables(_callerNotePath?: string): Promise<string[]> {
            const files = plugin.app.vault
                .getFiles()
                .filter((file) => file.extension === "ipt");
            const names = new Set<string>();

            for (const file of files) {
                try {
                    const tableNames = await readTableNames(plugin, file);
                    for (const tableName of tableNames) {
                        names.add(tableName);
                    }
                } catch (error: unknown) {
                    console.warn(
                        `randomness-frontmatter: skipping unreadable/unparseable .ipt "${file.path}"`,
                        error
                    );
                }
            }

            return [...names].sort((a, b) => a.localeCompare(b));
        },
        /**
         * Scope-aware listing. In-scope items come from the caller
         * note's Use: graph (same pipeline TableAutocomplete uses
         * for inline suggestions). Out-of-scope items come from a
         * vault-wide .ipt scan via discoverGenerators, minus any
         * name already present in scope.
         *
         * Silent-degrades on per-stage errors (broken Use: ref,
         * unparseable .ipt, etc.) so callers get a partial answer
         * instead of an exception — same graceful-degradation
         * pattern as the autocomplete popup.
         */
        async tablesWithSources(
            callerNotePath?: string
        ): Promise<TableSource[]> {
            const notePath = resolveCallerNotePath(plugin, {
                callerNotePath,
            });
            const { vault } = plugin.app;

            // Stage 1: in-scope tables for the caller note.
            const inScope: TableSource[] = [];
            if (notePath) {
                try {
                    const file = vault.getAbstractFileByPath(notePath);
                    if (file instanceof TFile && file.extension === "md") {
                        const source = await vault.read(file);
                        const asyncSource = vaultFileSource(vault);
                        const prefetch = await prefetchUseGraph({
                            entryPath: notePath,
                            entrySource: source,
                            generatorRoot:
                                plugin.settings.generatorRoot || undefined,
                            source: asyncSource,
                        });
                        const bundle = buildInlineBundle(
                            "__inline_tables_with_sources__",
                            {
                                notePath,
                                noteSource: source,
                                source: prefetch.source,
                                generatorRoot:
                                    plugin.settings.generatorRoot ||
                                    undefined,
                            }
                        );
                        const collected = collectTablesFromBundle(
                            bundle.extras,
                            bundle.loadedPaths
                        );
                        for (const t of collected) {
                            inScope.push({
                                name: t.name,
                                source: t.source,
                                isMain: t.isMain,
                                inScope: true,
                                filePath: t.filePath,
                            });
                        }
                    }
                } catch (error: unknown) {
                    console.warn(
                        "randomness-frontmatter: tablesWithSources in-scope build failed",
                        error
                    );
                }
            }

            // Cheap lookup for the dedupe step below.
            const inScopeNames = new Set(
                inScope.map((t) => t.name.toLowerCase())
            );

            // Stage 2: vault-wide tables, excluding anything already
            // in scope. discoverGenerators walks every .ipt under
            // the configured generator root (or the whole vault).
            const outOfScope: TableSource[] = [];
            try {
                const discovered = await discoverGenerators(plugin);
                const seen = new Set<string>();
                for (const result of discovered) {
                    if (!result.ok) continue;
                    const { gen } = result;
                    for (let i = 0; i < gen.tables.length; i++) {
                        const t = gen.tables[i];
                        const key = t.name.toLowerCase();
                        // Skip if already in-scope OR if a previous
                        // .ipt declared the same name (first-wins
                        // mirrors the evaluator's behaviour).
                        if (inScopeNames.has(key)) continue;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        outOfScope.push({
                            name: t.name,
                            source: gen.title,
                            isMain: i === 0,
                            inScope: false,
                            filePath: gen.path,
                        });
                    }
                }
            } catch (error: unknown) {
                console.warn(
                    "randomness-frontmatter: tablesWithSources vault scan failed",
                    error
                );
            }

            // In-scope first so the caller (a SuggestModal) can keep
            // the most-useful options at the top of the list.
            return [...inScope, ...outOfScope];
        },
        onRoll(callback: RollEventListener): () => void {
            listeners.add(callback);
            return () => {
                listeners.delete(callback);
            };
        },
    };
}

function resolveCallerNotePath(
    plugin: RandomnessPlugin,
    opts?: RollOptions
): string {
    return (
        opts?.callerNotePath ??
        plugin.app.workspace.getActiveFile()?.path ??
        ""
    );
}

async function readTableNames(
    plugin: RandomnessPlugin,
    file: TFile
): Promise<string[]> {
    let source: string;
    try {
        source = await plugin.app.vault.read(file);
    } catch (error: unknown) {
        throw new Error(
            `Failed to read table file "${file.path}": ${errorMessage(error)}`
        );
    }

    try {
        return parseGeneratorFile(source).tables.map((table) => table.name);
    } catch (error: unknown) {
        throw new Error(
            `Failed to parse table file "${file.path}": ${errorMessage(error)}`
        );
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
