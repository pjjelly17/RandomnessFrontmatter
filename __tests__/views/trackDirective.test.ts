/**
 * @jest-environment jsdom
 */

import {
    fileDeclaresUsedTracking,
    lineDeclaresUsedTracking,
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
