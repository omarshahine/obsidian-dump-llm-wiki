import { Plugin, Notice, normalizePath, TFile } from "obsidian";
import type { DumpSettings, CliStatus, InputType, AgentCallbacks } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { DumpSettingTab } from "./settings";
import { DumpAgentLoop } from "./agent/loop";
import { INGEST_PROMPT, QUERY_PROMPT, LINT_PROMPT } from "./agent/prompts";
import { buildDumpContext } from "./agent/context";
import { isPodcastURL, resolveApplePodcastsURL } from "./services/apple-podcasts";
import { transcribeAudio } from "./services/transcriber";
import { detectClis, runViaCli, buildIngestPrompt } from "./services/claude-cli";
import { DumpModal } from "./ui/DumpModal";
import { QueryModal } from "./ui/QueryModal";
import { StatusModal, gatherStats } from "./ui/StatusModal";

const LINT_INTERVALS: Record<string, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

export default class DumpPlugin extends Plugin {
  settings: DumpSettings = DEFAULT_SETTINGS;
  cliStatus: CliStatus = { claude: false, claudePath: "", ghCopilot: false, ghCopilotPath: "" };
  private agent!: DumpAgentLoop;
  private lintIntervalId: number | null = null;
  private statusBarEl!: HTMLElement;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.agent = new DumpAgentLoop(this.app, this.settings);
    this.addSettingTab(new DumpSettingTab(this.app, this));
    this.statusBarEl = this.addStatusBarItem();
    this.setStatus("");

    // Detect available CLIs
    detectClis().then((status) => {
      this.cliStatus = status;
    });

    // ─── Commands ────────────────────────────────────────────────────
    this.addCommand({
      id: "ingest-url",
      name: "Dump URL",
      callback: () => this.showDumpModal(),
    });

    this.addCommand({
      id: "ingest-clipboard",
      name: "Dump clipboard",
      callback: () => this.dumpClipboard(),
    });

    this.addCommand({
      id: "ingest-selection",
      name: "Dump selection",
      editorCallback: (editor) => {
        const sel = editor.getSelection();
        if (sel && sel.trim()) {
          this.runDump(sel.trim());
        } else {
          new Notice("No text selected.");
        }
      },
    });

    this.addCommand({
      id: "query",
      name: "Query knowledge base",
      callback: () => this.showQueryModal(),
    });

    this.addCommand({
      id: "lint",
      name: "Lint wiki",
      callback: () => this.runLint(),
    });

    this.addCommand({
      id: "status",
      name: "Show status",
      callback: () => this.showStatus(),
    });

    this.addCommand({
      id: "process-inbox",
      name: "Process inbox",
      callback: () => this.processExistingInbox(),
    });

    // ─── Ribbon icon ─────────────────────────────────────────────────
    this.addRibbonIcon("database", "Dump to KB", () => this.showDumpModal());

    // ─── Scheduled lint ──────────────────────────────────────────────
    this.setupLintInterval();

    // ─── Inbox watcher ──────────────────────────────────────────────
    this.setupInboxWatcher();
  }

  onunload(): void {
    if (this.lintIntervalId !== null) {
      window.clearInterval(this.lintIntervalId);
    }
  }

  // ─── Commands ─────────────────────────────────────────────────────────

  private showDumpModal(): void {
    if (!this.requireApiKey()) return;
    new DumpModal(this.app, (input) => this.runDump(input)).open();
  }

  private async dumpClipboard(): Promise<void> {
    if (!this.requireApiKey()) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        new Notice("Clipboard is empty.");
        return;
      }
      this.runDump(text.trim());
    } catch {
      new Notice("Could not read clipboard.");
    }
  }

  private showQueryModal(): void {
    if (!this.requireApiKey()) return;
    new QueryModal(this.app, (question) => this.runQuery(question)).open();
  }

  private async showStatus(): Promise<void> {
    await this.ensureDumpFolder();
    const stats = await gatherStats(this.app, this.settings.dumpFolder);
    new StatusModal(this.app, stats).open();
  }

  // ─── Core Operations ──────────────────────────────────────────────────

  private pendingDumps: string[] = [];

  private async runDump(input: string): Promise<void> {
    console.log("Dump: runDump called with:", input);

    if (this.processingLock) {
      // Queue it instead of dropping it
      this.pendingDumps.push(input);
      this.setStatus(`Queued (${this.pendingDumps.length} waiting)...`);
      return;
    }

    await this.ensureDumpFolder();
    const inputType = detectInputType(input);
    const date = new Date().toISOString().split("T")[0];

    let hostname = "";
    try {
      hostname = inputType === "url" ? new URL(input).hostname.replace("www.", "") : "";
    } catch {
      console.error("Dump: Invalid URL:", input);
      new Notice("Invalid URL.");
      this.setStatus("");
      return;
    }

    const slug = input
      .replace(/^https?:\/\//, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase()
      .substring(0, 60)
      .replace(/-$/, "");
    const inboxPath = normalizePath(`${this.settings.dumpFolder}/inbox/${date}-${slug}.md`);
    console.log("Dump: Saving to", inboxPath);

    const fileContent = [
      "---",
      inputType === "url" ? `source: "${input}"` : "",
      `captured: ${date}`,
      "tags:",
      "  - dump",
      hostname ? `  - ${hostname.replace(/\./g, "-")}` : "",
      `type: ${inputType}`,
      "status: inbox",
      "---",
      inputType === "url" ? `Extract and ingest: ${input}` : input,
    ].filter(Boolean).join("\n");

    try {
      await this.ensureParentFolder(inboxPath);
      // If file already exists (re-dump of same URL), overwrite it
      const existing = this.app.vault.getFileByPath(inboxPath);
      if (existing) {
        await this.app.vault.modify(existing, fileContent);
      } else {
        await this.app.vault.create(inboxPath, fileContent);
      }
      this.setStatus("Processing...");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Dump: Failed to create file:", msg);
      new Notice(`Dump: Failed — ${msg}`);
      return;
    }

    this.processingLock = true;
    try {
      const inboxFile = this.app.vault.getFileByPath(inboxPath);
      console.log("Dump: Found inbox file?", !!inboxFile);
      if (inboxFile) {
        await this.processInboxFile(inboxFile);
        this.filesProcessedThisSession++;
        console.log("Dump: Processing complete");
      }
    } catch (e) {
      console.error("Dump: Processing error:", e);
      new Notice(`Dump: Error — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.processingLock = false;
      // Process next queued dump if any
      if (this.pendingDumps.length > 0) {
        const next = this.pendingDumps.shift()!;
        this.setStatus(`Processing next (${this.pendingDumps.length} queued)...`);
        this.runDump(next);
      } else {
        this.setStatus("Done.");
      }
    }
  }

  private async runQuery(question: string): Promise<void> {
    await this.ensureDumpFolder();

    const context = buildDumpContext(this.app, this.settings.dumpFolder);
    const agentMessage = [
      context,
      "",
      `The Dump folder is: ${this.settings.dumpFolder}`,
      "",
      `Question: ${question}`,
    ].join("\n");

    new Notice("Searching knowledge base...");
    this.agent.clear();
    let finalResponse = "";

    await this.agent.run(agentMessage, QUERY_PROMPT, this.buildCallbacks(
      (text) => { finalResponse = text; }
    ));

    if (finalResponse) {
      // Save query result as an output file
      const date = new Date().toISOString().split("T")[0];
      const slug = question
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .substring(0, 50);
      const outputPath = normalizePath(
        `${this.settings.dumpFolder}/outputs/query-${date}-${slug}.md`
      );

      try {
        await this.ensureParentFolder(outputPath);
        await this.app.vault.create(
          outputPath,
          `---\nquestion: "${question}"\ndate: ${date}\n---\n${finalResponse}`
        );
        new Notice(`Answer saved to ${outputPath}`);

        // Open the result
        const file = this.app.vault.getFileByPath(outputPath);
        if (file) {
          await this.app.workspace.getLeaf(false).openFile(file);
        }
      } catch {
        new Notice(finalResponse.substring(0, 300));
      }
    }
  }

  async runLint(): Promise<void> {
    if (!this.requireApiKey()) return;
    await this.ensureDumpFolder();

    const context = buildDumpContext(this.app, this.settings.dumpFolder);
    const agentMessage = [
      context,
      "",
      `The Dump folder is: ${this.settings.dumpFolder}`,
      "",
      "Run a full health audit of the knowledge base.",
    ].join("\n");

    new Notice("Running wiki lint...");
    this.agent.clear();
    let finalResponse = "";

    await this.agent.run(agentMessage, LINT_PROMPT, this.buildCallbacks(
      (text) => { finalResponse = text; }
    ));

    if (finalResponse) {
      new Notice("Lint complete. Check outputs/ for the report.");
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private buildCallbacks(onFinalResponse: (text: string) => void): AgentCallbacks {
    return {
      onThinking: () => {},
      onToolCall: () => {},
      onToolResult: (_name, result) => {
        if (result.isError) {
          console.error(`Dump tool error:`, result.result);
        }
      },
      onResponse: (text) => onFinalResponse(text),
      onError: (error) => {
        console.error("Dump agent error:", error);
        new Notice(`Dump: Error — ${error.substring(0, 100)}`, 8000);
      },
    };
  }

  /** Check if CLI is configured and available */
  private isCliReady(): boolean {
    if (!this.settings.useCli || this.settings.primaryCli === "none") return false;
    if (this.settings.primaryCli === "claude") return this.cliStatus.claude;
    if (this.settings.primaryCli === "github-copilot") return this.cliStatus.ghCopilot;
    return false;
  }

  private setStatus(text: string): void {
    if (text) {
      this.statusBarEl.setText(`📥 ${text}`);
    } else {
      this.statusBarEl.empty();
    }
  }

  private requireApiKey(): boolean {
    if (this.isCliReady()) return true; // CLI doesn't need an API key
    if (!this.settings.apiKey) {
      new Notice("Please configure your API key in Dump settings (or install Claude CLI).");
      return false;
    }
    return true;
  }

  private async ensureDumpFolder(): Promise<void> {
    const folder = normalizePath(this.settings.dumpFolder);
    const subfolders = [
      `${folder}/inbox`,
      `${folder}/raw`,
      `${folder}/raw/assets`,
      `${folder}/wiki`,
      `${folder}/outputs`,
    ];

    for (const path of subfolders) {
      try {
        if (!this.app.vault.getFolderByPath(path)) {
          await this.app.vault.createFolder(path);
        }
      } catch {
        // Folder already exists, ignore
      }
    }

    // Seed index.md if missing
    const indexPath = normalizePath(`${folder}/wiki/index.md`);
    if (!this.app.vault.getFileByPath(indexPath)) {
      try {
        const date = new Date().toISOString().split("T")[0];
        await this.app.vault.create(
          indexPath,
          `---\ntitle: Dump Wiki Index\ncreated: ${date}\nlast_updated: ${date}\n---\nMaster index of all wiki pages, organized by category. Updated automatically on every dump.\n\n## Categories\n\n<!-- New categories and pages are added here automatically -->\n`
        );
      } catch { /* already exists */ }
    }

    // Seed log.md if missing
    const logPath = normalizePath(`${folder}/wiki/log.md`);
    if (!this.app.vault.getFileByPath(logPath)) {
      try {
        const date = new Date().toISOString().split("T")[0];
        await this.app.vault.create(
          logPath,
          `---\ntitle: Dump Log\ncreated: ${date}\n---\nChronological record of all ingest, query, and lint operations.\n\n<!-- New entries are prepended below this line -->\n`
        );
      } catch { /* already exists */ }
    }
  }

  private async ensureParentFolder(filePath: string): Promise<void> {
    const parentPath = filePath.substring(0, filePath.lastIndexOf("/"));
    if (parentPath && !this.app.vault.getFolderByPath(parentPath)) {
      try {
        await this.app.vault.createFolder(parentPath);
      } catch { /* already exists */ }
    }
  }

  // ─── Inbox Watcher ────────────────────────────────────────────────────

  private processingLock = false;
  private filesProcessedThisSession = 0;

  private setupInboxWatcher(): void {
    // Watch for new files — notify only, don't auto-process
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (!(file instanceof TFile)) return;
        if (!file.path.startsWith(normalizePath(`${this.settings.dumpFolder}/inbox/`))) return;
        if (file.extension !== "md") return;

        this.setStatus(`Queued: ${file.basename}`); 
      })
    );

    // Delayed auto-process: wait N minutes after boot, then process up to maxFilesPerSession
    const delayMs = (this.settings.autoProcessDelay || 5) * 60 * 1000;
    if (delayMs > 0) {
      this.registerInterval(
        window.setTimeout(() => {
          this.autoProcessInbox();
        }, delayMs) as unknown as number
      );
    }
  }

  /** Auto-process runs once, delayed after boot. Processes up to maxFilesPerSession. */
  private async autoProcessInbox(): Promise<void> {
    if (!this.isCliReady() && !this.settings.apiKey) return;
    if (this.processingLock) return;

    const inboxFiles = this.getInboxFiles();
    if (inboxFiles.length === 0) return;

    const cap = this.settings.maxFilesPerSession || 3;
    const toProcess = Math.min(inboxFiles.length, cap);

    this.setStatus(`Processing ${toProcess} file(s)...`);

    this.processingLock = true;
    try {
      for (let i = 0; i < toProcess; i++) {
        if (this.filesProcessedThisSession >= cap) {
          this.setStatus(`Cap reached (${cap}).`); 
          break;
        }
        console.log(`Dump: Processing ${inboxFiles[i].basename} (${i + 1}/${toProcess})`);
        await this.processInboxFile(inboxFiles[i]);
        this.filesProcessedThisSession++;
      }

      const remaining = this.getInboxFiles().length;
      if (remaining > 0) {
        this.setStatus(`Done. ${remaining} remaining.`); 
      } else {
        this.setStatus(""); 
      }
    } finally {
      this.processingLock = false;
    }
  }

  /** Manual "Process inbox" command. Processes one file at a time, respects session cap. */
  private async processExistingInbox(): Promise<void> {
    if (!this.isCliReady() && !this.settings.apiKey) {
      new Notice("Dump: No API key and CLI unavailable. Configure in Settings > Dump.");
      return;
    }

    if (this.processingLock) {
      this.setStatus("Busy...");
      return;
    }

    await this.ensureDumpFolder();

    const files = this.getInboxFiles();
    if (files.length === 0) {
      this.setStatus("Inbox empty."); 
      return;
    }

    const cap = this.settings.maxFilesPerSession || 3;
    if (this.filesProcessedThisSession >= cap) {
      new Notice(`Dump: Session cap reached (${cap} files). Restart Obsidian to reset, or increase cap in settings.`);
      return;
    }

    this.processingLock = true;
    try {
      this.setStatus(`Processing ${files[0].basename}...`);
      await this.processInboxFile(files[0]);
      this.filesProcessedThisSession++;

      const remaining = this.getInboxFiles().length;
      if (remaining > 0) {
        const left = cap - this.filesProcessedThisSession;
        this.setStatus(`Done. ${remaining} in inbox.`); 
      } else {
        this.setStatus("Done."); 
      }
    } finally {
      this.processingLock = false;
    }
  }

  private getInboxFiles(): TFile[] {
    const inboxPath = normalizePath(`${this.settings.dumpFolder}/inbox`);
    return this.app.vault.getMarkdownFiles().filter(
      (f) => f.path.startsWith(inboxPath + "/")
    );
  }

  private async processInboxFile(file: TFile): Promise<void> {
    // Verify file still exists
    const current = this.app.vault.getFileByPath(file.path);
    if (!current) return;

    const content = await this.app.vault.cachedRead(current);
    if (!content.includes("status: inbox")) return;

    console.log(`Dump: Processing ${current.basename}`);

    // Determine where the raw file should go
    const rawPath = normalizePath(current.path.replace("/inbox/", "/raw/"));

    // Move inbox -> raw, handling all edge cases
    let actualRawPath = rawPath;
    try {
      // Check if raw file already exists (using adapter for reliable check)
      const adapter = this.app.vault.adapter;
      const rawExists = await adapter.exists(rawPath);

      if (rawExists) {
        // Raw already exists from a previous attempt. Overwrite it with inbox content, then delete inbox.
        const rawFile = this.app.vault.getFileByPath(rawPath);
        if (rawFile) {
          await this.app.vault.modify(rawFile, content.replace("status: inbox", "status: raw"));
        }
        await this.app.vault.trash(current, true);
      } else {
        // Normal case: move inbox to raw
        await this.ensureParentFolder(rawPath);
        try {
          await this.app.fileManager.renameFile(current, rawPath);
        } catch {
          // renameFile failed — copy content manually
          try { await this.app.vault.create(rawPath, content.replace("status: inbox", "status: raw")); } catch { /* */ }
          try { await this.app.vault.trash(current, true); } catch { /* */ }
        }
        // Update status
        const movedFile = this.app.vault.getFileByPath(rawPath);
        if (movedFile) {
          try {
            await this.app.vault.process(movedFile, (data) => data.replace("status: inbox", "status: raw"));
          } catch { /* */ }
        }
      }
    } catch (e) {
      console.error("Dump: Move failed, processing from inbox:", e);
      actualRawPath = current.path; // Fall back to processing from inbox location
    }

    // Run the AI processing
    if (this.isCliReady()) {
      const vaultPath = (this.app.vault.adapter as { basePath?: string }).basePath;
      if (vaultPath) {
        const absRawPath = `${vaultPath}/${actualRawPath}`;
        const absDumpFolder = `${vaultPath}/${this.settings.dumpFolder}`;
        const prompt = buildIngestPrompt(absDumpFolder, absRawPath);
        const result = await runViaCli(this.settings.primaryCli, vaultPath, prompt, {
          model: this.settings.cliModel,
          allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "WebFetch"],
        });
        if (result.success) {
          this.setStatus("Done.");
          return;
        }
        console.error("Dump: CLI failed, falling back to API:", result.output);
      }
    }

    // Fallback: direct API call
    if (!this.settings.apiKey) {
      new Notice("Dump: No API key and CLI unavailable. Configure in Settings > Dump.");
      return;
    }

    const context = buildDumpContext(this.app, this.settings.dumpFolder);
    const agentMessage = [
      context,
      "",
      `A new source has been added: "${rawPath}"`,
      `The Dump folder is: ${this.settings.dumpFolder}`,
      "",
      "Process this source file:",
      "1. Read it to understand the content",
      "2. Create or update wiki pages based on the content",
      "3. Update the index and log",
      "",
      "The raw file already exists at the path above. Do NOT create a new raw file.",
      "Just read it and create wiki pages.",
    ].join("\n");

    await this.ensureDumpFolder();
    this.agent.clear();

    await this.agent.run(agentMessage, INGEST_PROMPT, this.buildCallbacks(
      () => {}
    ));
  }

  // ─── Scheduled Lint ───────────────────────────────────────────────────

  setupLintInterval(): void {
    if (this.lintIntervalId !== null) {
      window.clearInterval(this.lintIntervalId);
      this.lintIntervalId = null;
    }

    const intervalMs = LINT_INTERVALS[this.settings.lintInterval];
    if (!intervalMs) return;

    this.lintIntervalId = this.registerInterval(
      window.setInterval(() => {
        if (this.settings.apiKey) {
          this.runLint();
        }
      }, intervalMs)
    );
  }

  // ─── Settings Persistence ─────────────────────────────────────────────

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);

    if (!this.settings.apiModel) {
      this.settings.apiModel = DEFAULT_SETTINGS.apiModel;
    }

    // Load API keys from SecretStorage (not data.json)
    this.settings.apiKey = this.loadApiKey(this.settings.apiProvider);
    this.settings.openaiApiKey = this.loadApiKey("openai-whisper");
  }

  async saveSettings(): Promise<void> {
    this.saveApiKey(this.settings.apiProvider, this.settings.apiKey || "");
    this.saveApiKey("openai-whisper", this.settings.openaiApiKey || "");

    const toSave = { ...this.settings, apiKey: "", openaiApiKey: "" };
    await this.saveData(toSave);
  }

  reloadApiKeyForProvider(): void {
    this.settings.apiKey = this.loadApiKey(this.settings.apiProvider);
  }

  private loadApiKey(provider: string): string {
    try {
      return this.app.secretStorage.getSecret(`dump-llm-wiki-api-key-${provider}`) || "";
    } catch {
      return "";
    }
  }

  private saveApiKey(provider: string, key: string): void {
    try {
      this.app.secretStorage.setSecret(`dump-llm-wiki-api-key-${provider}`, key);
    } catch {
      // SecretStorage not available
    }
  }
}

// ─── Input Detection ────────────────────────────────────────────────────────

function detectInputType(input: string): InputType {
  if (/^https?:\/\//i.test(input)) {
    if (isPodcastURL(input)) return "podcast";
    return "url";
  }
  return "text";
}
