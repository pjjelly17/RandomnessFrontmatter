/**
 * "Roll into property" command — Phase 1 item #2, Phase 1.5
 * upgrade for scope-aware table picking.
 *
 * Two-step flow:
 *   1. SuggestModal lists tables visible from the API, in-scope
 *      first then out-of-scope (vault-wide, not imported).
 *   2. Modal prompts for the property key.
 *   3. If the picked table was out-of-scope, inject a `Use:` line
 *      into the active note (preferring the editor for undo-group
 *      affinity, falling back to vault.modify if no editor is
 *      attached).
 *   4. api.rollIntoProperty(key, table) writes the result into
 *      the active note's frontmatter via app.fileManager
 *      .processFrontMatter.
 *
 * Why inject Use: before rolling: rollIntoProperty resolves the
 * table through the scoped resolver, which will not see tables
 * that aren't reachable from the active note's Use: graph. Picking
 * one of those tables from a vault-wide list would otherwise fail
 * with "table not found" — confusing to the user, since the table
 * was right there in the picker. Auto-injecting the import is the
 * direct, undoable resolution.
 */

import {
    App,
    Modal,
    Notice,
    SuggestModal,
    TFile,
} from "obsidian";
import type RandomnessPlugin from "./main";
import type { TableSource } from "../api";
import { ensureUseInSource } from "./useInjection";

class TableSuggestModal extends SuggestModal<TableSource> {
    constructor(
        app: App,
        private readonly tables: TableSource[],
        private readonly onChoose: (item: TableSource) => void
    ) {
        super(app);
        this.setPlaceholder("Pick a table to roll…");
    }

    getSuggestions(query: string): TableSource[] {
        // Case-insensitive substring filter on name. Preserve
        // incoming order, which the API already structured as
        // in-scope-first.
        const q = query.trim().toLowerCase();
        if (!q) return this.tables;
        return this.tables.filter((t) =>
            t.name.toLowerCase().includes(q)
        );
    }

    renderSuggestion(item: TableSource, el: HTMLElement): void {
        // Two-row layout: name on top, source subtitle below.
        // Out-of-scope items get a "(not imported)" prefix so the
        // user knows picking this will inject a Use: line.
        //
        // Plain DOM + inline styles (not the EditorSuggest CSS
        // classes from tableAutocomplete) because SuggestModal is
        // themed differently — reusing those classes would inherit
        // unrelated layout. Inline styles keep the cost local;
        // no new global CSS gets introduced for one modal.
        const nameEl = el.createEl("div", { text: item.name });
        nameEl.style.fontWeight = "500";
        const sub = el.createEl("small");
        sub.style.opacity = "0.7";
        sub.textContent = item.inScope
            ? item.source
            : `(not imported) ${item.source}`;
    }

    onChooseSuggestion(item: TableSource): void {
        this.onChoose(item);
    }
}

class PropertyKeyModal extends Modal {
    private value = "";

    constructor(
        app: App,
        private readonly item: TableSource,
        private readonly onSubmit: (key: string, item: TableSource) => void
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl("h3", {
            text: `Roll [@${this.item.name}] into property…`,
        });
        contentEl.createEl("p", {
            text: "Property key (frontmatter field name):",
        });

        const input = contentEl.createEl("input", {
            type: "text",
            placeholder: "e.g. faction, npc-name, weather",
        });
        input.style.width = "100%";
        input.style.marginBottom = "0.75em";
        input.focus();

        input.addEventListener("input", () => {
            this.value = input.value;
        });
        input.addEventListener("keydown", (evt) => {
            if (evt.key === "Enter" && this.value.trim().length > 0) {
                evt.preventDefault();
                this.submit();
            }
        });

        const submitBtn = contentEl.createEl("button", { text: "Roll" });
        submitBtn.addEventListener("click", () => this.submit());
    }

    private submit(): void {
        const key = this.value.trim();
        if (!key) {
            new Notice("Property key required");
            return;
        }
        this.close();
        this.onSubmit(key, this.item);
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/**
 * Inject `Use: <filePath>` into the given file via vault.modify.
 *
 * We deliberately bypass the editor (editor.replaceRange) because
 * the subsequent roll uses the resolver, which reads file content
 * through vault.read. An editor-only write leaves the on-disk
 * source stale until Obsidian's debounced save catches up — racing
 * our roll and making the freshly-imported table unresolvable.
 * vault.modify writes synchronously to disk AND propagates back
 * into the editor view, so the user sees the same final state
 * either way. We give up tight undo-grouping (Ctrl-Z reverts the
 * Use: write alone, not also the frontmatter write) in exchange
 * for correctness.
 *
 * Returns the number of source lines added (0 if the Use: line
 * was already there).
 */
async function injectUseLine(
    plugin: RandomnessPlugin,
    file: TFile,
    filePath: string
): Promise<number> {
    const source = await plugin.app.vault.read(file);
    const { newSource, linesAdded } = ensureUseInSource(
        source,
        filePath
    );
    if (linesAdded > 0) {
        await plugin.app.vault.modify(file, newSource);
    }
    return linesAdded;
}

export function registerRollIntoPropertyCommand(
    plugin: RandomnessPlugin
): void {
    plugin.addCommand({
        id: "roll-into-property",
        name: "Roll table into frontmatter property…",
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
                    "Randomness Frontmatter: failed to list tables"
                );
                console.error(
                    "randomness-frontmatter: api.tablesWithSources() failed",
                    error
                );
                return;
            }
            if (tables.length === 0) {
                new Notice(
                    "Randomness Frontmatter: no .ipt tables found in vault"
                );
                return;
            }

            new TableSuggestModal(plugin.app, tables, (item) => {
                new PropertyKeyModal(
                    plugin.app,
                    item,
                    async (key, picked) => {
                        try {
                            // For out-of-scope picks, inject Use:
                            // FIRST so the scoped resolver in
                            // rollIntoProperty can see the table.
                            // Without this, the roll would fail on
                            // first try and the user would have to
                            // re-run the command.
                            if (!picked.inScope && picked.filePath) {
                                const linesAdded = await injectUseLine(
                                    plugin,
                                    file,
                                    picked.filePath
                                );
                                if (linesAdded > 0) {
                                    new Notice(
                                        `Added "Use: ${picked.filePath}" to randomness codeblock`
                                    );
                                }
                            }

                            const rollResult =
                                await plugin.api.rollIntoProperty(
                                    key,
                                    picked.name
                                );
                            new Notice(
                                `Rolled [@${picked.name}] → ${key}: ${rollResult.result}`
                            );
                        } catch (error: unknown) {
                            new Notice(
                                `Randomness Frontmatter: roll failed — ${error instanceof Error ? error.message : String(error)}`
                            );
                            console.error(
                                "randomness-frontmatter: roll-into-property failed",
                                error
                            );
                        }
                    }
                ).open();
            }).open();
        },
    });
}
