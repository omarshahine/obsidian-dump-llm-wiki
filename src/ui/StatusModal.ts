import { App, Modal, normalizePath } from "obsidian";
import type { WikiStats } from "../types";

/**
 * Modal that displays knowledge base statistics.
 */
export class StatusModal extends Modal {
  private stats: WikiStats;

  constructor(app: App, stats: WikiStats) {
    super(app);
    this.stats = stats;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("dump-status-modal");
    contentEl.createEl("h2", { text: "Knowledge Base Status" });

    const stats = this.stats;

    // Stats table
    const table = contentEl.createEl("div");

    this.addRow(table, "Raw sources", String(stats.rawCount));
    this.addRow(table, "Wiki pages", String(stats.wikiCount));
    this.addRow(table, "Reports", String(stats.outputCount));
    this.addRow(table, "Categories", String(stats.categories.length));
    this.addRow(table, "Orphaned sources", String(stats.orphanedRaw));

    if (stats.categories.length > 0) {
      contentEl.createEl("h3", { text: "Categories" });
      const catList = contentEl.createEl("ul");
      for (const cat of stats.categories) {
        catList.createEl("li", { text: cat });
      }
    }

    if (stats.recentLog.length > 0) {
      contentEl.createEl("h3", { text: "Recent Activity" });
      const logEl = contentEl.createEl("div", { cls: "recent-activity" });
      for (const entry of stats.recentLog) {
        logEl.createEl("p", { text: entry });
      }
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private addRow(container: HTMLElement, label: string, value: string): void {
    const row = container.createEl("div", { cls: "stat-row" });
    row.createEl("span", { cls: "stat-label", text: label });
    row.createEl("span", { text: value });
  }
}

/**
 * Gather wiki stats from the vault.
 */
export async function gatherStats(
  app: App,
  dumpFolder: string
): Promise<WikiStats> {
  const prefix = normalizePath(dumpFolder);
  const allFiles = app.vault.getMarkdownFiles();

  const rawFiles = allFiles.filter((f) => f.path.startsWith(`${prefix}/raw/`));
  const wikiFiles = allFiles.filter(
    (f) =>
      f.path.startsWith(`${prefix}/wiki/`) &&
      !f.path.endsWith("index.md") &&
      !f.path.endsWith("log.md")
  );
  const outputFiles = allFiles.filter((f) =>
    f.path.startsWith(`${prefix}/outputs/`)
  );

  // Extract categories from index.md
  const categories: string[] = [];
  const indexPath = normalizePath(`${dumpFolder}/wiki/index.md`);
  const indexFile = app.vault.getFileByPath(indexPath);
  if (indexFile) {
    const content = await app.vault.cachedRead(indexFile);
    const catMatches = content.matchAll(/^## (.+)$/gm);
    for (const match of catMatches) {
      if (match[1] !== "Categories") {
        categories.push(match[1]);
      }
    }
  }

  // Check for orphaned raw files (not referenced by any wiki page)
  let orphanedRaw = 0;
  const allLinks = app.metadataCache.resolvedLinks;
  for (const rawFile of rawFiles) {
    let referenced = false;
    for (const [, targets] of Object.entries(allLinks)) {
      if (targets[rawFile.path]) {
        referenced = true;
        break;
      }
    }
    if (!referenced) orphanedRaw++;
  }

  // Recent log entries
  const recentLog: string[] = [];
  const logPath = normalizePath(`${dumpFolder}/wiki/log.md`);
  const logFile = app.vault.getFileByPath(logPath);
  if (logFile) {
    const content = await app.vault.cachedRead(logFile);
    const entries = content.match(/^## .+$/gm) || [];
    for (const entry of entries.slice(-5).reverse()) {
      recentLog.push(entry.replace("## ", ""));
    }
  }

  return {
    rawCount: rawFiles.length,
    wikiCount: wikiFiles.length,
    outputCount: outputFiles.length,
    categories,
    recentLog,
    orphanedRaw,
  };
}
