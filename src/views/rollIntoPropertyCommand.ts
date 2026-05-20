/**
 * "Roll into property" command — Phase 1 item #2.
 *
 * Two-step flow:
 *   1. SuggestModal lists tables visible from the API.
 *   2. Modal prompts for the property key.
 *   3. api.rollIntoProperty(key, table) writes the result into the
 *      active note's frontmatter via app.fileManager.processFrontMatter.
 *
 * Uses the public JS API (src/api) rather than reaching into engine
 * internals — eats own dogfood per ISA principle.
 */

import { App, Modal, Notice, SuggestModal, TFile } from "obsidian";
import type RandomnessPlugin from "./main";

class TableSuggestModal extends SuggestModal<string> {
    constructor(
        app: App,
        private readonly tables: string[],
        private readonly onChoose: (table: string) => void
    ) {
        super(app);
        this.setPlaceholder("Pick a table to roll…");
    }

    getSuggestions(query: string): string[] {
        const q = query.trim().toLowerCase();
        if (!q) return this.tables;
        return this.tables.filter((t) => t.toLowerCase().includes(q));
    }

    renderSuggestion(table: string, el: HTMLElement): void {
        el.createEl("div", { text: table });
    }

    onChooseSuggestion(table: string): void {
        this.onChoose(table);
    }
}

class PropertyKeyModal extends Modal {
    private value = "";

    constructor(
        app: App,
        private readonly table: string,
        private readonly onSubmit: (key: string) => void
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl("h3", {
            text: `Roll [@${this.table}] into property…`,
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
        this.onSubmit(key);
    }

    onClose(): void {
        this.contentEl.empty();
    }
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

            let tables: string[];
            try {
                tables = await plugin.api.tables();
            } catch (error: unknown) {
                new Notice("Randomness Frontmatter: failed to list tables");
                console.error("randomness-frontmatter: api.tables() failed", error);
                return;
            }
            if (tables.length === 0) {
                new Notice(
                    "Randomness Frontmatter: no .ipt tables found in vault"
                );
                return;
            }

            new TableSuggestModal(plugin.app, tables, (table) => {
                new PropertyKeyModal(plugin.app, table, async (key) => {
                    try {
                        const rollResult = await plugin.api.rollIntoProperty(
                            key,
                            table
                        );
                        new Notice(
                            `Rolled [@${table}] → ${key}: ${rollResult.result}`
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
                }).open();
            }).open();
        },
    });
}
