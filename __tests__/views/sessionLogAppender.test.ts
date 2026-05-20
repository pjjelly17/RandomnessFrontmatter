/**
 * @jest-environment jsdom
 */

import { TFile } from "obsidian";
import type { RollResult } from "../../src/api";
import {
    appendRollToSessionNote,
    resolveSessionNote,
} from "../../src/views/sessionLogAppender";
import {
    DEFAULT_SETTINGS,
    RandomnessSettings,
} from "../../src/views/settings";

type FileCacheLike = { frontmatter?: unknown } | null;

function makeSettings(
    overrides: Partial<RandomnessSettings> = {}
): RandomnessSettings {
    return {
        ...DEFAULT_SETTINGS,
        sessionAutoAppend: DEFAULT_SETTINGS.sessionAutoAppend,
        sessionTypeKey: DEFAULT_SETTINGS.sessionTypeKey,
        sessionTypeValue: DEFAULT_SETTINGS.sessionTypeValue,
        ...overrides,
    } as RandomnessSettings;
}

function makeMarkdownFile(path: string, mtime: number): TFile {
    // The obsidian module mock in __mocks__ exports a minimal TFile stub; we
    // populate the fields the resolver/appender actually read instead of going
    // through the real constructor (the mock's properties aren't initialised).
    const file = new TFile();
    const name = path.replace(/^.*\//, "");
    const writable = file as unknown as {
        path: string;
        name: string;
        basename: string;
        extension: string;
        stat: { mtime: number; ctime: number; size: number };
    };
    writable.path = path;
    writable.name = name;
    writable.basename = name.replace(/\.md$/, "");
    writable.extension = "md";
    writable.stat = { mtime, ctime: mtime, size: 0 };
    return file;
}

function makePlugin(opts: {
    settings?: Partial<RandomnessSettings>;
    caches?: Map<TFile, FileCacheLike>;
    sources?: Record<string, string>;
    modify?: (file: TFile, newSource: string) => Promise<void>;
}) {
    const caches = opts.caches ?? new Map<TFile, FileCacheLike>();
    const sourceByPath = new Map<string, string>(
        Object.entries(opts.sources ?? {})
    );
    const read = jest.fn(async (file: TFile): Promise<string> => {
        const source = sourceByPath.get(file.path);
        if (source === undefined) {
            throw new Error(`missing source for ${file.path}`);
        }
        return source;
    });
    const modify =
        opts.modify ??
        jest.fn(async (file: TFile, newSource: string): Promise<void> => {
            sourceByPath.set(file.path, newSource);
        });

    return {
        plugin: {
            app: {
                vault: {
                    getMarkdownFiles(): TFile[] {
                        return [...caches.keys()];
                    },
                    read,
                    modify,
                },
                metadataCache: {
                    getFileCache(file: TFile): FileCacheLike {
                        return caches.get(file) ?? null;
                    },
                },
            },
            settings: makeSettings(opts.settings),
        },
        read,
        modify,
        sourceByPath,
    };
}

function makeRollResult(overrides: Partial<RollResult> = {}): RollResult {
    return {
        table: "Encounters",
        result: "2 goblins",
        expression: "[@Encounters]",
        timestamp: "2026-05-20T19:45:00.000Z",
        rollId: "roll-1",
        ...overrides,
    };
}

describe("resolveSessionNote", () => {
    test("returns null when the selector key is blank", () => {
        const sessionFile = makeMarkdownFile("Sessions/a.md", 1000);
        const caches = new Map<TFile, FileCacheLike>([
            [sessionFile, { frontmatter: { type: "session", date: "2026-05-20" } }],
        ]);
        const { plugin } = makePlugin({
            settings: { sessionTypeKey: "" },
            caches,
        });

        expect(resolveSessionNote(plugin as never)).toBeNull();
    });

    test("picks the newest frontmatter date and breaks ties with mtime", () => {
        const older = makeMarkdownFile("Sessions/older.md", 1000);
        const tieLowerMtime = makeMarkdownFile("Sessions/tie-a.md", 2000);
        const tieHigherMtime = makeMarkdownFile("Sessions/tie-b.md", 3000);
        const nonSession = makeMarkdownFile("Sessions/other.md", 4000);
        const caches = new Map<TFile, FileCacheLike>([
            [older, { frontmatter: { type: "session", date: "2026-05-19" } }],
            [tieLowerMtime, { frontmatter: { type: "session", date: "2026-05-20" } }],
            [tieHigherMtime, { frontmatter: { type: "session", date: "2026-05-20" } }],
            [nonSession, { frontmatter: { type: "prep", date: "2026-05-21" } }],
        ]);
        const { plugin } = makePlugin({ caches });

        expect(resolveSessionNote(plugin as never)).toBe(tieHigherMtime);
    });

    test("falls back to mtime when date is missing and treats invalid dates as oldest", () => {
        const missingDate = makeMarkdownFile("Sessions/missing-date.md", 5000);
        const invalidDate = makeMarkdownFile("Sessions/invalid-date.md", 9000);
        const caches = new Map<TFile, FileCacheLike>([
            [missingDate, { frontmatter: { type: "session" } }],
            [invalidDate, { frontmatter: { type: "session", date: "not-a-date" } }],
        ]);
        const { plugin } = makePlugin({ caches });

        expect(resolveSessionNote(plugin as never)).toBe(missingDate);
    });
});

describe("appendRollToSessionNote", () => {
    test("bails before vault I/O when the feature is disabled", async () => {
        const sessionFile = makeMarkdownFile("Sessions/a.md", 1000);
        const caches = new Map<TFile, FileCacheLike>([
            [sessionFile, { frontmatter: { type: "session", date: "2026-05-20" } }],
        ]);
        const { plugin, read, modify } = makePlugin({
            settings: { sessionAutoAppend: false },
            caches,
            sources: { "Sessions/a.md": "body" },
        });

        await appendRollToSessionNote(
            plugin as never,
            makeRollResult()
        );

        expect(read).not.toHaveBeenCalled();
        expect(modify).not.toHaveBeenCalled();
    });

    test("appends one formatted line to the resolved session note", async () => {
        const sessionFile = makeMarkdownFile("Sessions/a.md", 1000);
        const caches = new Map<TFile, FileCacheLike>([
            [sessionFile, { frontmatter: { type: "session", date: "2026-05-20" } }],
        ]);
        const { plugin, sourceByPath } = makePlugin({
            settings: { sessionAutoAppend: true },
            caches,
            sources: { "Sessions/a.md": "Session body" },
        });
        const rollResult = makeRollResult();
        const parsedDate = new Date(rollResult.timestamp);
        const expectedTime = `${String(parsedDate.getHours()).padStart(2, "0")}:${String(parsedDate.getMinutes()).padStart(2, "0")}`;

        await appendRollToSessionNote(plugin as never, rollResult);

        expect(sourceByPath.get("Sessions/a.md")).toBe(
            `Session body\n- ${expectedTime} rolled Encounters: 2 goblins\n`
        );
    });

    test("silently skips when no session note matches", async () => {
        const file = makeMarkdownFile("Notes/a.md", 1000);
        const caches = new Map<TFile, FileCacheLike>([
            [file, { frontmatter: { type: "prep", date: "2026-05-20" } }],
        ]);
        const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        const { plugin, read, modify } = makePlugin({
            settings: { sessionAutoAppend: true },
            caches,
            sources: { "Notes/a.md": "Prep note" },
        });

        await appendRollToSessionNote(
            plugin as never,
            makeRollResult()
        );

        expect(read).not.toHaveBeenCalled();
        expect(modify).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    test("logs and swallows vault errors", async () => {
        const sessionFile = makeMarkdownFile("Sessions/a.md", 1000);
        const caches = new Map<TFile, FileCacheLike>([
            [sessionFile, { frontmatter: { type: "session", date: "2026-05-20" } }],
        ]);
        const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
        const modify = jest.fn(async (): Promise<void> => {
            throw new Error("disk full");
        });
        const { plugin } = makePlugin({
            settings: { sessionAutoAppend: true },
            caches,
            sources: { "Sessions/a.md": "Session body\n" },
            modify,
        });

        await expect(
            appendRollToSessionNote(plugin as never, makeRollResult())
        ).resolves.toBeUndefined();
        expect(warnSpy).toHaveBeenCalledWith(
            "randomness-frontmatter: session log append failed",
            expect.any(Error)
        );
        warnSpy.mockRestore();
    });
});
