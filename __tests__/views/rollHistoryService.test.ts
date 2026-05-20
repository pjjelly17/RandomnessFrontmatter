/**
 * @jest-environment jsdom
 */

import type { RollResult } from "../../src/api";
import {
    appendRollToHistory,
    HISTORY_FILE_PATH,
    loadRollHistory,
} from "../../src/views/rollHistoryService";
import {
    DEFAULT_SETTINGS,
    RandomnessSettings,
} from "../../src/views/settings";

function makeSettings(
    overrides: Partial<RandomnessSettings> = {}
): RandomnessSettings {
    return {
        ...DEFAULT_SETTINGS,
        ...overrides,
    };
}

function makeRollResult(overrides: Partial<RollResult> = {}): RollResult {
    return {
        table: "Encounters",
        result: "2 goblins",
        expression: "[@Encounters]",
        source: "Notes/session.md",
        timestamp: "2026-05-20T19:45:00.000Z",
        rollId: "roll-1",
        ...overrides,
    };
}

function makePlugin(opts: {
    settings?: Partial<RandomnessSettings>;
    files?: Record<string, string>;
    write?: (path: string, data: string) => Promise<void>;
    exists?: (path: string) => Promise<boolean>;
    read?: (path: string) => Promise<string>;
    createFolder?: (path: string) => Promise<void>;
} = {}) {
    const files = new Map<string, string>(Object.entries(opts.files ?? {}));
    const exists =
        opts.exists ??
        jest.fn(async (path: string): Promise<boolean> => files.has(path));
    const read =
        opts.read ??
        jest.fn(async (path: string): Promise<string> => {
            const value = files.get(path);
            if (value === undefined) {
                throw new Error(`missing file: ${path}`);
            }
            return value;
        });
    const write =
        opts.write ??
        jest.fn(async (path: string, data: string): Promise<void> => {
            files.set(path, data);
        });
    const createFolder =
        opts.createFolder ??
        jest.fn(async (_path: string): Promise<void> => {});

    return {
        plugin: {
            app: {
                vault: {
                    adapter: {
                        exists,
                        read,
                        write,
                    },
                    createFolder,
                },
            },
            settings: makeSettings(opts.settings),
        },
        exists,
        read,
        write,
        createFolder,
        files,
    };
}

describe("loadRollHistory", () => {
    test("returns an empty array when the history file is missing", async () => {
        const { plugin, read } = makePlugin();

        await expect(loadRollHistory(plugin as never)).resolves.toEqual([]);
        expect(read).not.toHaveBeenCalled();
    });

    test("round-trips failure entries and preserves the error flag", async () => {
        const { plugin, files } = makePlugin();
        const failedResult = makeRollResult({
            result: "[ROLL ERROR: bad table reference]",
            error: "bad table reference",
            source: "",
            rollId: "roll-error",
        });

        await appendRollToHistory(plugin as never, failedResult);

        const stored = files.get(HISTORY_FILE_PATH);
        expect(stored).toBeDefined();
        const entries = await loadRollHistory(plugin as never);
        expect(entries).toEqual([
            {
                rollId: "roll-error",
                table: "Encounters",
                result: "[ROLL ERROR: bad table reference]",
                expression: "[@Encounters]",
                timestamp: "2026-05-20T19:45:00.000Z",
                sourcePath: "",
                error: "bad table reference",
            },
        ]);
    });
});

describe("appendRollToHistory", () => {
    test("bails before any vault I/O when history is disabled", async () => {
        const { plugin, exists, read, write, createFolder } = makePlugin({
            settings: { historyEnabled: false },
        });

        await appendRollToHistory(plugin as never, makeRollResult());

        expect(exists).not.toHaveBeenCalled();
        expect(read).not.toHaveBeenCalled();
        expect(write).not.toHaveBeenCalled();
        expect(createFolder).not.toHaveBeenCalled();
    });

    test("enforces FIFO eviction at the configured cap", async () => {
        // Production clamps historyMaxEntries to [10, 500] (see
        // historyMaxEntries() in rollHistoryService.ts). Use cap=10
        // and insert 11 entries to verify the oldest is evicted.
        const { plugin } = makePlugin({
            settings: { historyEnabled: true, historyMaxEntries: 10 },
        });

        for (let i = 1; i <= 11; i++) {
            await appendRollToHistory(
                plugin as never,
                makeRollResult({
                    rollId: `roll-${i}`,
                    result: `result-${i}`,
                })
            );
        }

        const entries = await loadRollHistory(plugin as never);
        expect(entries).toHaveLength(10);
        expect(entries[0].rollId).toBe("roll-2");
        expect(entries[entries.length - 1].rollId).toBe("roll-11");
    });
});
