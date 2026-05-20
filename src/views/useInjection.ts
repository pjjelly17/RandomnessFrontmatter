/**
 * Shared helpers for injecting `Use: <path>` lines into a note's
 * `randomness` codeblock.
 *
 * Two call sites:
 *   1. tableAutocomplete.ts — when the user picks an out-of-scope
 *      table from the inline `rdm:` autocomplete popup.
 *   2. rollIntoPropertyCommand.ts — when the user picks an out-of-
 *      scope table from the "Roll into property…" command's
 *      SuggestModal.
 *
 * Both call sites want the same semantics: ensure a `Use:` line
 * exists somewhere in some `randomness` codeblock so the scoped
 * resolver can see the file. The editor-based path is preferred
 * (single undo group, instant feedback); the source-string path
 * is the fallback for when no editor is attached to the active
 * file (e.g. user invoked the command from the palette while a
 * non-markdown view was focused).
 *
 * Why extract: the autocomplete grew these helpers organically;
 * the property-roll command needs the same semantics; duplicating
 * would invite drift. One module, one source of truth.
 */

import type { Editor } from "obsidian";

/**
 * Find the first ```randomness``` codeblock in an editor's
 * content. Returns the line indices of the opening fence, the
 * first content line, and one-past-the-last content line, OR null
 * if there's no such block.
 *
 * Why scan the editor directly (not parse markdown structure):
 *   - The editor is the single source of truth at this moment.
 *   - We only need the FIRST block, so a simple line scan is fine.
 *   - The fence syntax is unambiguous: ```randomness opens,
 *     ``` (alone on a line) closes. The block content is
 *     everything between.
 *   - A markdown parser would be overkill and would drag a
 *     dependency through the autocomplete module.
 */
export function findFirstRandomnessCodeblock(
    editor: Editor
): { openLine: number; contentStart: number; contentEnd: number } | null {
    const lines = editor.lineCount();
    for (let i = 0; i < lines; i++) {
        const line = editor.getLine(i).trim();
        // Accept "```randomness" with optional trailing whitespace.
        // Doesn't accept "````randomness" (four backticks) — those
        // are a different fence variant and rare enough to skip.
        if (/^```\s*randomness\s*$/.test(line)) {
            const contentStart = i + 1;
            // Find the closing fence.
            for (let j = contentStart; j < lines; j++) {
                const inner = editor.getLine(j).trim();
                if (inner === "```") {
                    return {
                        openLine: i,
                        contentStart,
                        contentEnd: j,
                    };
                }
            }
            // Unterminated codeblock — treat the rest of the file
            // as content (defensive; this is malformed markdown but
            // we shouldn't crash).
            return {
                openLine: i,
                contentStart,
                contentEnd: lines,
            };
        }
    }
    return null;
}

/**
 * Return the 0-indexed line number of the closing `---` of the
 * note's frontmatter (if present), or -1 if no frontmatter.
 *
 * Frontmatter is recognised only when the very first line is
 * exactly `---` and there's a subsequent `---` line. Anything
 * else means no frontmatter, return -1.
 */
export function findFrontmatterEnd(editor: Editor): number {
    if (editor.lineCount() === 0) return -1;
    const firstLine = editor.getLine(0).trim();
    if (firstLine !== "---") return -1;
    for (let i = 1; i < editor.lineCount(); i++) {
        if (editor.getLine(i).trim() === "---") return i;
    }
    // Unterminated frontmatter — treat as no frontmatter so the
    // codeblock goes at the very top. Less ideal than refusing
    // the operation, but autocomplete in a malformed note
    // shouldn't fail loudly.
    return -1;
}

/**
 * Ensure the current note has `Use: <filePath>` in some
 * ```randomness``` codeblock. Strategy:
 *
 *   - If a codeblock exists and already has the line: no-op.
 *   - If a codeblock exists without the line: insert `Use:`
 *     into that codeblock, right after any existing Use lines.
 *   - If no codeblock exists: create one at the top of the
 *     note (after frontmatter) containing just `Use: <path>`.
 *
 * Returns the number of lines added above the cursor's
 * current position, so the caller can adjust the cursor for
 * the shift. Returns 0 if the edit was a no-op or happened
 * below the cursor.
 *
 * The edit goes through the editor (not vault.modify) so
 * it's part of the same undo group as whatever else the caller
 * just did — one Ctrl-Z undoes both.
 */
export function ensureUseInScope(
    editor: Editor,
    filePath: string
): number {
    // Scan for an existing randomness codeblock.
    const block = findFirstRandomnessCodeblock(editor);
    if (block !== null) {
        // Check if the desired Use: line is already there.
        const usePath = filePath.trim();
        for (let i = block.contentStart; i < block.contentEnd; i++) {
            const line = editor.getLine(i).trim();
            // Match "Use: <path>" tolerantly — whitespace
            // variations and case-insensitive path comparison
            // (vault paths are case-insensitive on most OSes).
            const m = /^use\s*:\s*(.+)$/i.exec(line);
            if (m && m[1].trim().toLowerCase() === usePath.toLowerCase()) {
                // Already imported. No-op.
                return 0;
            }
        }
        // Insert after the last existing Use: line, or at the
        // top of the body if there are none.
        let insertAfter = block.contentStart - 1; // line of the opening fence
        for (let i = block.contentStart; i < block.contentEnd; i++) {
            if (/^\s*use\s*:/i.test(editor.getLine(i))) {
                insertAfter = i;
            }
        }
        const insertLine = insertAfter + 1;
        const newLine = `Use: ${filePath}`;
        editor.replaceRange(
            `${newLine}\n`,
            { line: insertLine, ch: 0 },
            { line: insertLine, ch: 0 }
        );
        // The line was inserted BEFORE the cursor only if the
        // codeblock is above the cursor.
        const cursor = editor.getCursor();
        return insertLine <= cursor.line ? 1 : 0;
    }

    // No codeblock exists. Create one at the top of the note,
    // after frontmatter if any. A bare codeblock with only
    // Use: lines is unusual but legal; it renders empty,
    // which is fine — it's serving as a scope declaration.
    const frontmatterEnd = findFrontmatterEnd(editor);
    // Insert after the frontmatter line (or at line 0 if no
    // frontmatter). Add a blank line before AND after the
    // codeblock so it doesn't smush against other content.
    const insertLine = frontmatterEnd + 1;
    const codeblock =
        "```randomness\n" +
        `Use: ${filePath}\n` +
        "```\n\n";
    editor.replaceRange(
        codeblock,
        { line: insertLine, ch: 0 },
        { line: insertLine, ch: 0 }
    );
    // 4 lines added: fence, Use line, closing fence, blank.
    const linesAdded = 4;
    const cursor = editor.getCursor();
    return insertLine <= cursor.line ? linesAdded : 0;
}

/**
 * Source-string variant of ensureUseInScope. Used by the
 * rollIntoProperty command when the active file isn't being
 * edited in a MarkdownView (e.g. command invoked while a
 * non-markdown view is focused, or the file is open in
 * preview-only mode). Mirrors ensureUseInScope's three-branch
 * strategy without needing an Editor instance.
 *
 * Returns the new source plus a linesAdded count (which the
 * caller may report in the user-facing Notice or use to drive
 * a "no-op vs added" branch).
 *
 * Why a separate function: the editor variant uses Editor APIs
 * (replaceRange, getCursor) that don't have equivalents on a
 * raw string. Trying to share the bulk of the logic via a
 * common "lines + cursor" abstraction would require the caller
 * to assemble that abstraction either way; cleaner to write a
 * tight string-only version here.
 */
export function ensureUseInSource(
    source: string,
    filePath: string
): { newSource: string; linesAdded: number } {
    const usePath = filePath.trim();
    const lines = source.split("\n");

    // Locate the first randomness codeblock, mirroring the editor
    // scan in findFirstRandomnessCodeblock above.
    let openLine = -1;
    let contentStart = -1;
    let contentEnd = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^```\s*randomness\s*$/.test(lines[i].trim())) {
            openLine = i;
            contentStart = i + 1;
            for (let j = contentStart; j < lines.length; j++) {
                if (lines[j].trim() === "```") {
                    contentEnd = j;
                    break;
                }
            }
            if (contentEnd === -1) {
                // Unterminated — treat the rest of the file as content.
                contentEnd = lines.length;
            }
            break;
        }
    }

    if (openLine !== -1) {
        // Codeblock exists. Check for an already-matching Use: line.
        for (let i = contentStart; i < contentEnd; i++) {
            const m = /^use\s*:\s*(.+)$/i.exec(lines[i].trim());
            if (m && m[1].trim().toLowerCase() === usePath.toLowerCase()) {
                return { newSource: source, linesAdded: 0 };
            }
        }
        // Insert after the last existing Use: line, or at the top
        // of the body if there are none.
        let insertAfter = contentStart - 1;
        for (let i = contentStart; i < contentEnd; i++) {
            if (/^\s*use\s*:/i.test(lines[i])) {
                insertAfter = i;
            }
        }
        const insertAt = insertAfter + 1;
        lines.splice(insertAt, 0, `Use: ${filePath}`);
        return { newSource: lines.join("\n"), linesAdded: 1 };
    }

    // No codeblock. Create one after frontmatter (or at line 0).
    let frontmatterEnd = -1;
    if (lines.length > 0 && lines[0].trim() === "---") {
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === "---") {
                frontmatterEnd = i;
                break;
            }
        }
    }
    const insertAt = frontmatterEnd + 1;
    const block = [
        "```randomness",
        `Use: ${filePath}`,
        "```",
        "",
    ];
    lines.splice(insertAt, 0, ...block);
    return { newSource: lines.join("\n"), linesAdded: block.length };
}
