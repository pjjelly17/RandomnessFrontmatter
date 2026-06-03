/**
 * @jest-environment jsdom
 */

import {
    isUsed,
    loadUsed,
    markUsed,
    unmarkUsed,
    usedKeyFor,
    USED_FILE_PATH,
} from "../../src/views/usedTracker";
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

describe("usedTracker", () => {
    test("round-trips mark/load and reports isUsed", async () => {
        const { plugin } = makePlugin();

        await markUsed(plugin as never, "Plant", "Anise oil");

        await expect(loadUsed(plugin as never)).resolves.toEqual([
            expect.objectContaining({
                key: usedKeyFor("Plant", "Anise oil"),
                table: "Plant",
                result: "Anise oil",
            }),
        ]);
        await expect(
            isUsed(plugin as never, "Plant", "Anise oil")
        ).resolves.toBe(true);
    });

    test("markUsed is idempotent and does not rewrite existing entries", async () => {
        const { plugin, write } = makePlugin();

        await markUsed(plugin as never, "Plant", "Anise oil");
        expect(write).toHaveBeenCalledTimes(1);

        await markUsed(plugin as never, "Plant", "Anise oil");

        expect(write).toHaveBeenCalledTimes(1);
        await expect(loadUsed(plugin as never)).resolves.toHaveLength(1);
    });

    test("unmark removes an existing used entry", async () => {
        const { plugin } = makePlugin();

        await markUsed(plugin as never, "Plant", "Anise oil");
        await unmarkUsed(plugin as never, "Plant", "Anise oil");

        await expect(loadUsed(plugin as never)).resolves.toEqual([]);
        await expect(
            isUsed(plugin as never, "Plant", "Anise oil")
        ).resolves.toBe(false);
    });

    test("isUsed is case-insensitive and trims whitespace", async () => {
        const { plugin } = makePlugin();

        await markUsed(plugin as never, "Plant", "Anise oil");

        await expect(
            isUsed(plugin as never, "plant", "ANISE OIL")
        ).resolves.toBe(true);
        await expect(
            isUsed(plugin as never, "PLANT", " anise oil ")
        ).resolves.toBe(true);
    });

    test("writes the canonical used file path", async () => {
        const { plugin, files } = makePlugin();

        await markUsed(plugin as never, "Plant", "Anise oil");

        expect(files.has(USED_FILE_PATH)).toBe(true);
    });
});
