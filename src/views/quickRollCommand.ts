/**
 * "Quick roll table" command — Phase 1 item #3.
 *
 * Read-only sibling to "roll into property": pick any table in the
 * vault, roll it immediately, show a short Notice, and copy the
 * full rendered result to the clipboard.
 *
 * Why it does not mutate notes: unlike rollIntoProperty, there is
 * no frontmatter write target and no need to inject a `Use:` line.
 * Out-of-scope rolls go through an API path that evaluates against
 * a synthetic in-memory note source instead of touching the active
 * note.
 */

import { Notice, SuggestModal, TFile } from "obsidian";
import type { TableSource } from "../api";
import type RandomnessPlugin from "./main";

function truncate(s: string, n: number): string {
    // Keep the Notice readable while the clipboard preserves the
    // full rendered output.
    if (s.length <= n) return s;
    return s.slice(0, n - 1) + "…";
}

class QuickRollSuggestModal extends SuggestModal<TableSource> {
    constructor(
        private readonly plugin: RandomnessPlugin,
        private readonly tables: TableSource[],
    ) {
        super(plugin.app);
        this.setPlaceholder("Pick a table to roll…");
    }

    getSuggestions(query: string): TableSource[] {
        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery) return this.tables;
        return this.tables.filter((table) =>
            table.name.toLowerCase().includes(normalizedQuery),
        );
    }

    renderSuggestion(item: TableSource, el: HTMLElement): void {
        el.classList.add("randomness-suggest-item");

        const nameText = item.isMain ? `★ ${item.name}` : item.name;
        el.createEl("div", { cls: "randomness-suggest-name", text: nameText });

        el.createEl("div", {
            cls: "randomness-suggest-source",
            text: item.inScope ? item.source : `(not imported) ${item.source}`,
        });
    }

    async onChooseSuggestion(
        item: TableSource,
        _evt: MouseEvent | KeyboardEvent,
    ): Promise<void> {
        try {
            if (!item.inScope && !item.filePath) {
                new Notice(
                    "Randomness Frontmatter: quick-roll cannot resolve table source",
                );
                return;
            }

            const result = item.inScope
                ? await this.plugin.api.roll(item.name)
                : await this.plugin.api.rollUnscoped(item.name, item.filePath);

            try {
                // Clipboard access can fail on some desktop setups
                // even when the roll succeeded. That should not hide
                // the actual result from the user.
                await navigator.clipboard.writeText(result.result);
            } catch (clipError: unknown) {
                console.warn(
                    "randomness-frontmatter: clipboard write failed",
                    clipError,
                );
            }

            new Notice(`[@${item.name}] → ${truncate(result.result, 120)}`);
        } catch (error: unknown) {
            const message =
                error instanceof Error ? error.message : String(error);
            new Notice(
                `Randomness Frontmatter: roll failed — ${message}`,
            );
            console.error(
                "randomness-frontmatter: quick-roll failed",
                error,
            );
        }
    }
}

export function registerQuickRollCommand(plugin: RandomnessPlugin): void {
    plugin.addCommand({
        id: "quick-roll",
        name: "Quick roll table…",
        callback: async () => {
            const file = plugin.app.workspace.getActiveFile();
            if (!(file instanceof TFile)) {
                new Notice("Randomness Frontmatter: no active note");
                return;
            }

            let tables: TableSource[];
            try {
                tables = await plugin.api.tablesWithSources(file.path);
            } catch (error: unknown) {
                new Notice(
                    "Randomness Frontmatter: failed to list tables",
                );
                console.error(
                    "randomness-frontmatter: quick-roll tablesWithSources failed",
                    error,
                );
                return;
            }

            if (tables.length === 0) {
                new Notice(
                    "Randomness Frontmatter: no tables found in vault",
                );
                return;
            }

            // Re-query on every command invocation and open a fresh
            // modal so the picker always reflects the current note's
            // live scope without any shared cache. Preserve the API's
            // in-scope-first ordering; do not re-sort here.
            new QuickRollSuggestModal(plugin, tables).open();
        },
    });
}
