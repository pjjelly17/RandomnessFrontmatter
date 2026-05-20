import {
    ItemView,
    Notice,
    WorkspaceLeaf,
} from "obsidian";
import type RandomnessPlugin from "./main";
import type { HistoryEntry } from "./rollHistoryService";
import {
    loadRollHistory,
    waitForRollHistoryWrites,
} from "./rollHistoryService";

export const VIEW_TYPE_ROLL_HISTORY = "randomness-roll-history-view";
const SYNTHETIC_QUICK_ROLL_PREFIX = "__quick_roll__:";

export class RollHistoryView extends ItemView {
    private plugin: RandomnessPlugin;
    private listEl: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: RandomnessPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_ROLL_HISTORY;
    }

    getDisplayText(): string {
        return "Roll history";
    }

    getIcon(): string {
        return "dice";
    }

    async onOpen(): Promise<void> {
        const content = this.containerEl.children[1] as HTMLElement;
        clearElement(content);
        content.classList.add("randomness-roll-history-view");

        const inner = document.createElement("div");
        inner.className = "randomness-history";
        content.appendChild(inner);

        const header = document.createElement("div");
        header.className = "randomness-history-header";
        inner.appendChild(header);

        const title = document.createElement("h3");
        title.textContent = "Recent rolls";
        header.appendChild(title);

        const description = document.createElement("div");
        description.className = "randomness-history-description";
        description.textContent =
            "Newest first. Reroll repeats the table from its original context when possible.";
        inner.appendChild(description);

        this.listEl = document.createElement("div");
        this.listEl.className = "randomness-history-list";
        inner.appendChild(this.listEl);

        await this.renderHistory();
    }

    async onClose(): Promise<void> {
        this.listEl = null;
    }

    private async renderHistory(): Promise<void> {
        if (!this.listEl) {
            return;
        }

        clearElement(this.listEl);
        const entries = await loadRollHistory(this.plugin);
        const newestFirst = [...entries].reverse();

        if (newestFirst.length === 0) {
            const emptyState = document.createElement("div");
            emptyState.className = "randomness-history-empty";
            emptyState.textContent = "No rolls recorded yet.";
            this.listEl.appendChild(emptyState);
            return;
        }

        for (const entry of newestFirst) {
            this.listEl.appendChild(this.buildRow(entry));
        }
    }

    private buildRow(entry: HistoryEntry): HTMLElement {
        const row = document.createElement("div");
        row.className = "randomness-history-row";
        if (entry.error) {
            row.classList.add("randomness-history-row-error");
        }

        const main = document.createElement("div");
        main.className = "randomness-history-row-main";
        row.appendChild(main);

        const table = document.createElement("div");
        table.className = "randomness-history-row-table";
        table.textContent = `[@${entry.table}]`;
        main.appendChild(table);

        const result = document.createElement("div");
        result.className = "randomness-history-row-result";
        result.textContent = entry.result;
        main.appendChild(result);

        const meta = document.createElement("div");
        meta.className = "randomness-history-row-meta";
        meta.textContent = `${formatHistoryTimestamp(entry.timestamp)} · ${basenameForDisplay(entry.sourcePath)}`;
        main.appendChild(meta);

        const rerollButton = document.createElement("button");
        rerollButton.className = "randomness-history-row-reroll";
        rerollButton.type = "button";
        rerollButton.title = "Reroll this table";
        rerollButton.textContent = "↻";
        rerollButton.addEventListener("click", () => {
            void this.rerollEntry(entry, rerollButton);
        });
        row.appendChild(rerollButton);

        return row;
    }

    private async rerollEntry(
        entry: HistoryEntry,
        button: HTMLButtonElement
    ): Promise<void> {
        button.disabled = true;
        try {
            await this.plugin.api.roll(entry.table, {
                callerNotePath: resolveRerollCallerNotePath(entry.sourcePath),
            });
            await waitForRollHistoryWrites(this.plugin);
            await this.renderHistory();
        } catch (error: unknown) {
            const message =
                error instanceof Error ? error.message : String(error);
            new Notice(`Reroll failed: ${message}`);
        } finally {
            button.disabled = false;
        }
    }
}

export async function openRollHistoryView(
    plugin: RandomnessPlugin
): Promise<void> {
    const { workspace } = plugin.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_ROLL_HISTORY);
    if (existing.length > 0) {
        workspace.revealLeaf(existing[0]);
        return;
    }

    const leaf = workspace.getRightLeaf(false);
    if (!leaf) {
        // Without a right-sidebar leaf there is nowhere sensible to mount
        // this view, so the command exits quietly instead of throwing.
        return;
    }

    await leaf.setViewState({
        type: VIEW_TYPE_ROLL_HISTORY,
        active: true,
    });
    workspace.revealLeaf(leaf);
}

function clearElement(el: HTMLElement): void {
    while (el.firstChild) {
        el.removeChild(el.firstChild);
    }
}

function formatHistoryTimestamp(timestamp: string): string {
    const parsedDate = new Date(timestamp);
    const parsedMs = parsedDate.getTime();
    if (!Number.isFinite(parsedMs)) {
        return timestamp;
    }
    const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
    const day = String(parsedDate.getDate()).padStart(2, "0");
    const year = parsedDate.getFullYear();
    const hours = String(parsedDate.getHours()).padStart(2, "0");
    const minutes = String(parsedDate.getMinutes()).padStart(2, "0");
    return `${month}/${day}/${year} ${hours}:${minutes}`;
}

function basenameForDisplay(sourcePath: string): string {
    const displayPath = sourcePath.startsWith(SYNTHETIC_QUICK_ROLL_PREFIX)
        ? sourcePath.slice(SYNTHETIC_QUICK_ROLL_PREFIX.length)
        : sourcePath;
    if (displayPath === "") {
        return "—";
    }
    const parts = displayPath.split("/");
    return parts[parts.length - 1] || "—";
}

function resolveRerollCallerNotePath(
    sourcePath: string
): string | undefined {
    if (sourcePath === "") {
        return undefined;
    }
    if (sourcePath.startsWith(SYNTHETIC_QUICK_ROLL_PREFIX)) {
        return undefined;
    }
    return sourcePath;
}
