/**
 * Per-table "auto-dedup" opt-in via a comment-channel directive.
 *
 * A table file opts all its tables into used/unused tracking by
 * including a comment line anywhere in the file:
 *
 *     # Track: used
 *
 * Why a comment instead of a real `Track:` table directive? The IPP3
 * engine treats lines starting with `#`, `;`, or `//` as comments and
 * ignores them (see src/engine/fileParser.ts). Riding the comment
 * channel means:
 *   - zero engine changes — the fork stays decoupled from engine
 *     internals, the property the 1.0.11 re-port was built to keep;
 *   - backwards-compatible — upstream Randomness (and older versions)
 *     just see a comment, never a parse error;
 *   - roll-safe — the marker can never be mistaken for a table item.
 *
 * Scope is file-level: the marker anywhere in the file opts every
 * table in that file into tracking. Table-level scoping is a future
 * refinement — comments aren't structurally bound to a single table.
 */

import { TFile } from "obsidian";
import type RandomnessPlugin from "./main";

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strip inline `//` comments for table-boundary detection only. */
function stripInlineComment(line: string): string {
    const idx = line.indexOf("//");
    return idx === -1 ? line : line.slice(0, idx);
}

/**
 * Matches a whole comment line declaring used-tracking. Tolerant of
 * the comment prefix (`#`, `;`, `//`), surrounding whitespace, and
 * case: `# Track: used`, `#track:used`, `// TRACK : Used` all match.
 */
const TRACK_USED_RE = /^[ \t]*(?:#|;|\/\/)[ \t]*track[ \t]*:[ \t]*used[ \t]*$/im;

/**
 * True when the table's source file declares used-tracking via the
 * comment directive. Missing path, non-file, or read error → false
 * (fail-open to "not tracked"; a read hiccup must never silently
 * change roll behaviour).
 */
export async function fileDeclaresUsedTracking(
    plugin: RandomnessPlugin,
    filePath: string | undefined
): Promise<boolean> {
    if (!filePath) return false;
    try {
        const af = plugin.app.vault.getAbstractFileByPath(filePath);
        if (!(af instanceof TFile)) return false;
        const src = await plugin.app.vault.cachedRead(af);
        return TRACK_USED_RE.test(src);
    } catch (error: unknown) {
        console.warn(
            "randomness-frontmatter: track-directive read failed",
            error
        );
        return false;
    }
}

/** Exported for unit tests — the raw line matcher. */
export function lineDeclaresUsedTracking(source: string): boolean {
    return TRACK_USED_RE.test(source);
}

/**
 * Pure (testable) table-level track-directive check.
 *
 * Returns true if `# Track: used` appears in either:
 *   - the file-level scope (before any `Table:` declaration, or after `EndTable`) —
 *     acts as a global opt-in for all tables in the file; or
 *   - the named table's own block — opts in only that table.
 *
 * This replaces the file-wide match with a scoped one: a directive inside
 * table "Weapons" does NOT opt in table "Names".
 */
export function sourceTableDeclaresUsedTracking(src: string, tableName: string): boolean {
    const tableStartRe = new RegExp(
        `^Table:\\s*${escapeRegExp(tableName.trim())}(?:\\s*(?://.*)?)?$`,
        "i"
    );
    const anyTableRe = /^Table:\s*/i;
    const endTableRe = /^EndTable\b/i;

    type Scope = "file" | "target" | "other";
    let scope: Scope = "file";

    for (const rawLine of src.split(/\r?\n/)) {
        const trimmed = rawLine.trim();
        const noInline = stripInlineComment(trimmed).trim();

        if (scope === "file") {
            if (TRACK_USED_RE.test(trimmed)) return true;
            if (tableStartRe.test(noInline)) scope = "target";
            else if (anyTableRe.test(noInline)) scope = "other";
        } else if (scope === "target") {
            if (TRACK_USED_RE.test(trimmed)) return true;
            if (endTableRe.test(noInline)) scope = "file";
            else if (anyTableRe.test(noInline)) scope = tableStartRe.test(noInline) ? "target" : "other";
        } else {
            if (endTableRe.test(noInline)) scope = "file";
            else if (anyTableRe.test(noInline)) scope = tableStartRe.test(noInline) ? "target" : "other";
        }
    }
    return false;
}

/**
 * Async vault-aware wrapper around `sourceTableDeclaresUsedTracking`.
 * Missing path, non-file, or read error → false (fail-open).
 */
export async function tableDeclaresUsedTracking(
    plugin: RandomnessPlugin,
    filePath: string | undefined,
    tableName: string
): Promise<boolean> {
    if (!filePath) return false;
    try {
        const af = plugin.app.vault.getAbstractFileByPath(filePath);
        if (!(af instanceof TFile)) return false;
        const src = await plugin.app.vault.cachedRead(af);
        return sourceTableDeclaresUsedTracking(src, tableName);
    } catch (error: unknown) {
        console.warn(
            "randomness-frontmatter: table-track-directive read failed",
            error
        );
        return false;
    }
}
