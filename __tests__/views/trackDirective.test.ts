/**
 * @jest-environment jsdom
 */

import {
    fileDeclaresUsedTracking,
    lineDeclaresUsedTracking,
    sourceTableDeclaresUsedTracking,
} from "../../src/views/trackDirective";

describe("trackDirective: lineDeclaresUsedTracking", () => {
    test.each([
        ["# Track: used", "canonical"],
        ["#Track:used", "no spaces"],
        ["#   track   :   used   ", "extra whitespace"],
        ["// TRACK : Used", "slash comment, mixed case"],
        ["; track: used", "semicolon comment"],
        ["\t# track: used\t", "leading/trailing tabs"],
    ])("matches %j (%s)", (line) => {
        expect(lineDeclaresUsedTracking(line)).toBe(true);
    });

    test("matches when embedded in a real .ipt file", () => {
        const src = [
            "// names generator",
            "Table: NPC Name",
            "# Track: used",
            "1: Aldric",
            "1: Bryn",
        ].join("\n");
        expect(lineDeclaresUsedTracking(src)).toBe(true);
    });

    test.each([
        ["# Track: unused", "wrong value"],
        ["# Tracker: used", "wrong keyword"],
        ["# Track used", "missing colon"],
        ["Track: used", "no comment prefix (would be an engine item)"],
        ["1: Track: used", "weighted item content, not a comment"],
        ["", "empty"],
        ["Table: Foo\n1: bar", "ordinary table, no directive"],
    ])("does NOT match %j (%s)", (line) => {
        expect(lineDeclaresUsedTracking(line)).toBe(false);
    });
});

describe("trackDirective: sourceTableDeclaresUsedTracking", () => {
    const weapons = [
        "Table: Weapons",
        "# Track: used",
        "Sword",
        "Axe",
    ].join("\n");

    const multiTable = [
        "Table: Weapons",
        "# Track: used",
        "Sword",
        "Table: Names",
        "Aldric",
        "Bryn",
    ].join("\n");

    const fileLevelSrc = [
        "# Track: used",
        "Table: Weapons",
        "Sword",
        "Table: Names",
        "Aldric",
    ].join("\n");

    const noneTracked = [
        "Table: Weapons",
        "Sword",
        "Table: Names",
        "Aldric",
    ].join("\n");

    const endTableSrc = [
        "Table: Weapons",
        "Sword",
        "EndTable",
        "# Track: used",
        "Table: Names",
        "Aldric",
    ].join("\n");

    test("matches when directive is in the target table block", () => {
        expect(sourceTableDeclaresUsedTracking(weapons, "Weapons")).toBe(true);
    });

    test("does NOT match a different table when directive is in Weapons only", () => {
        expect(sourceTableDeclaresUsedTracking(multiTable, "Names")).toBe(false);
    });

    test("file-level directive (before any Table:) matches any table", () => {
        expect(sourceTableDeclaresUsedTracking(fileLevelSrc, "Weapons")).toBe(true);
        expect(sourceTableDeclaresUsedTracking(fileLevelSrc, "Names")).toBe(true);
    });

    test("returns false when no directive exists for the table", () => {
        expect(sourceTableDeclaresUsedTracking(noneTracked, "Weapons")).toBe(false);
        expect(sourceTableDeclaresUsedTracking(noneTracked, "Names")).toBe(false);
    });

    test("directive after EndTable is file-level and matches any subsequent table", () => {
        expect(sourceTableDeclaresUsedTracking(endTableSrc, "Names")).toBe(true);
    });

    test("table name match is case-insensitive", () => {
        expect(sourceTableDeclaresUsedTracking(weapons, "weapons")).toBe(true);
        expect(sourceTableDeclaresUsedTracking(weapons, "WEAPONS")).toBe(true);
    });

    test("returns false for unknown table name", () => {
        expect(sourceTableDeclaresUsedTracking(weapons, "Potions")).toBe(false);
    });

    test("handles Table: line with inline // comment", () => {
        const src = [
            "Table: Weapons // combat loot",
            "# Track: used",
            "Sword",
        ].join("\n");
        expect(sourceTableDeclaresUsedTracking(src, "Weapons")).toBe(true);
    });

    test("empty source returns false", () => {
        expect(sourceTableDeclaresUsedTracking("", "Weapons")).toBe(false);
    });
});

describe("trackDirective: fileDeclaresUsedTracking", () => {
    test("returns false for an undefined path without touching the vault", async () => {
        const plugin = {
            app: {
                vault: {
                    getAbstractFileByPath: jest.fn(() => {
                        throw new Error("must not be called");
                    }),
                },
            },
        } as never;
        await expect(
            fileDeclaresUsedTracking(plugin, undefined)
        ).resolves.toBe(false);
    });
});
