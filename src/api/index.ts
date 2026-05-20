/**
 * Public JS API surface for randomness-frontmatter v0.1.
 */

import { TFile } from "obsidian";
import { parseGeneratorFile } from "../engine/fileParser";
import { evaluateInlineExpression } from "../views/inlineProcessor";
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

export interface RollResult {
    /** The final rendered text. */
    result: string;
    /** The table name that was rolled (as requested). */
    table: string;
    /** The full expression that was evaluated (e.g. "[@Faction]"). */
    expression: string;
    /** Source file the table was resolved from, if known. Left undefined in v0.1 because the engine does not expose the resolved .ipt path. */
    source?: string;
    /** ISO 8601 timestamp of when the roll happened. */
    timestamp: string;
    /** Unique roll ID (crypto.randomUUID() or similar). Stable across the process; useful for history dedup. */
    rollId: string;
}

export type RollEventListener = (result: RollResult) => void;

export interface RandomnessFrontmatterAPI {
    readonly version: string;
    /** Wraps the requested table name as [@name]; names that need IPP3 escaping must already be passed in parser-safe form. */
    roll(tableName: string, opts?: RollOptions): Promise<RollResult>;
    rollExpression(rawExpr: string, opts?: RollOptions): Promise<RollResult>;
    rollIntoProperty(
        key: string,
        tableName: string,
        opts?: RollOptions
    ): Promise<RollResult>;
    /** Accepts callerNotePath for future scope-aware listing, but v0.1 returns the full vault-wide .ipt table list either way. */
    tables(callerNotePath?: string): Promise<string[]>;
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

    const rollExpression = async (
        rawExpr: string,
        opts?: RollOptions
    ): Promise<RollResult> => {
        const notePath = resolveCallerNotePath(plugin, opts);
        const table =
            (opts as InternalRollOptions | undefined)?.[
                REQUESTED_TABLE
            ] ?? rawExpr;
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

    return {
        version: API_VERSION,
        roll,
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
