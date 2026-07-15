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
    campaignSlugFor,
    usedFilePathFor,
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

describe("campaignSlugFor", () => {
    test.each([
        ["Glasstaff", "glasstaff"],
        ["Lilly", "lilly"],
        ["Glasstaff's Grand Design", "glasstaffs-grand-design"],
        ["Glasstaff’s Grand Design", "glasstaffs-grand-design"],
        ["My Campaign 2", "my-campaign-2"],
        ["  padded  ", "padded"],
        ["", ""],
        ["---", ""],
        ["NoStone5e", "nostone5e"],
    ])("slugifies %j → %j", (input, expected) => {
        expect(campaignSlugFor(input)).toBe(expected);
    });
});

describe("usedFilePathFor", () => {
    test("returns USED_FILE_PATH when activeCampaign is empty", () => {
        const plugin = { settings: makeSettings({ activeCampaign: "" }) };
        expect(usedFilePathFor(plugin as never)).toBe(USED_FILE_PATH);
    });

    test("returns campaign-scoped path for a named campaign", () => {
        const plugin = { settings: makeSettings({ activeCampaign: "Glasstaff" }) };
        expect(usedFilePathFor(plugin as never)).toBe("_rolls/used-glasstaff.md");
    });

    test("slugifies the campaign name in the path", () => {
        const plugin = { settings: makeSettings({ activeCampaign: "Glasstaff's Grand Design" }) };
        expect(usedFilePathFor(plugin as never)).toBe("_rolls/used-glasstaffs-grand-design.md");
    });
});

describe("usedTracker with activeCampaign", () => {
    test("markUsed writes to the campaign-scoped file", async () => {
        const { plugin, files } = makePlugin({ settings: { activeCampaign: "Glasstaff" } });

        await markUsed(plugin as never, "Names", "Aldric");

        expect(files.has("_rolls/used-glasstaff.md")).toBe(true);
        expect(files.has(USED_FILE_PATH)).toBe(false);
    });

    test("isUsed is scoped — Glasstaff entry not visible in Lilly campaign", async () => {
        const { plugin, files } = makePlugin({ settings: { activeCampaign: "Glasstaff" } });
        await markUsed(plugin as never, "Names", "Aldric");

        // Switch campaign
        plugin.settings.activeCampaign = "Lilly";
        expect(await isUsed(plugin as never, "Names", "Aldric")).toBe(false);

        // Switch back
        plugin.settings.activeCampaign = "Glasstaff";
        expect(await isUsed(plugin as never, "Names", "Aldric")).toBe(true);
    });
});
