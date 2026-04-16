import { App, Notice, PluginSettingTab, Setting, requestUrl } from "obsidian";
import type DumpPlugin from "./main";
import type { ApiProvider, CliProvider, CliStatus } from "./types";

interface ModelOption {
  value: string;
  label: string;
}

const FALLBACK_MODELS: Record<string, ModelOption[]> = {
  anthropic: [
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { value: "claude-opus-4-7", label: "Claude Opus 4.7" },
    { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4.1", label: "GPT-4.1" },
    { value: "o4-mini", label: "o4-mini" },
  ],
};

const modelCache = new Map<string, ModelOption[]>();

export class DumpSettingTab extends PluginSettingTab {
  plugin: DumpPlugin;

  constructor(app: App, plugin: DumpPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Dump LLM Wiki" });

    const s = this.plugin.settings;
    const cliStatus = this.plugin.cliStatus;

    // ═══════════════════════════════════════════════════════════════════
    containerEl.createEl("h3", { text: "Processing" });

    new Setting(containerEl)
      .setName("CLI tool")
      .setDesc(this.cliStatusText(cliStatus, s.primaryCli))
      .addDropdown((dropdown) => {
        dropdown.addOption("none", "None");
        dropdown.addOption("claude", `Claude Code${cliStatus.claude ? "" : " (not found)"}`);
        dropdown.addOption("github-copilot", "GitHub Copilot (coming soon)");
        dropdown.setValue(s.primaryCli);
        dropdown.onChange(async (value) => {
          s.primaryCli = value as CliProvider;
          if (value === "none") s.useCli = false;
          else s.useCli = true;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    if (s.primaryCli !== "none") {
      new Setting(containerEl)
        .setName("CLI model")
        .setDesc("Model for CLI processing")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("opus", "Opus")
            .addOption("sonnet", "Sonnet")
            .addOption("haiku", "Haiku")
            .setValue(s.cliModel)
            .onChange(async (value) => {
              s.cliModel = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(containerEl)
        .setName("Use CLI as primary")
        .setDesc("On: CLI first, API fallback. Off: API only.")
        .addToggle((toggle) =>
          toggle.setValue(s.useCli).onChange(async (value) => {
            s.useCli = value;
            await this.plugin.saveSettings();
          })
        );
    }

    // ═══════════════════════════════════════════════════════════════════
    containerEl.createEl("h3", { text: "API" + (s.useCli ? " (Fallback)" : "") });

    new Setting(containerEl)
      .setName("Provider")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("anthropic", "Anthropic")
          .addOption("openai", "OpenAI")
          .setValue(s.apiProvider)
          .onChange(async (value) => {
            s.apiProvider = value as ApiProvider;
            s.apiModel = "";
            this.plugin.reloadApiKeyForProvider();
            await this.plugin.saveSettings();
            setTimeout(() => this.display(), 10);
          })
      );

    const apiKeySetting = new Setting(containerEl)
      .setName("API key")
      .setDesc(s.apiKey ? "Key saved" : "Enter your API key")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("Enter your API key").setValue(s.apiKey).onChange(async (value) => {
          const hadKey = !!s.apiKey;
          s.apiKey = value.trim();
          await this.plugin.saveSettings();
          if (!hadKey && s.apiKey) setTimeout(() => this.display(), 10);
        });
      });

    if (s.apiKey) {
      apiKeySetting.addButton((button) =>
        button.setButtonText("Test").onClick(async () => {
          button.setButtonText("Testing...");
          button.setDisabled(true);
          try {
            const { sendMessage } = await import("./api/client");
            const response = await sendMessage(
              s,
              [{ role: "user", content: "Say hello in one word." }],
              [],
              "You are a test. Respond with one word."
            );
            const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
            new Notice(`Connected! Response: "${text}"`);
          } catch (e) {
            new Notice(`Failed: ${e instanceof Error ? e.message : String(e)}`);
          } finally {
            button.setButtonText("Test");
            button.setDisabled(false);
          }
        })
      );
    }

    const cached = modelCache.get(s.apiProvider);
    const models = cached || FALLBACK_MODELS[s.apiProvider] || FALLBACK_MODELS.anthropic;

    const modelSetting = new Setting(containerEl)
      .setName("Model")
      .setDesc(cached ? `${cached.length} models from API` : "Using defaults")
      .addDropdown((dropdown) => {
        for (const m of models) dropdown.addOption(m.value, m.label);
        dropdown.addOption("__custom__", "Custom...");
        if (s.apiModel && !models.some((m) => m.value === s.apiModel))
          dropdown.addOption(s.apiModel, `${s.apiModel} (current)`);
        dropdown.setValue(s.apiModel || models[0]?.value || "");
        dropdown.onChange(async (value) => {
          s.apiModel = value === "__custom__" ? "" : value;
          await this.plugin.saveSettings();
          if (value === "__custom__") setTimeout(() => this.display(), 10);
        });
      });

    if (s.apiKey) {
      modelSetting.addButton((btn) =>
        btn.setIcon("refresh-cw").setTooltip("Fetch models from API").onClick(async () => {
          btn.setDisabled(true);
          try {
            const fetched = await fetchModelsFromAPI(s.apiProvider, s.apiKey);
            modelCache.set(s.apiProvider, fetched);
            new Notice(`Loaded ${fetched.length} models`);
            if (!s.apiModel && fetched.length > 0) {
              s.apiModel = fetched[0].value;
              await this.plugin.saveSettings();
            }
            this.display();
          } catch (e) {
            new Notice(`Failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        })
      );
    }

    if (!s.apiModel) {
      new Setting(containerEl).setName("Custom model ID").addText((text) =>
        text.setPlaceholder(s.apiProvider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o")
          .setValue(s.apiModel).onChange(async (value) => {
            s.apiModel = value.trim();
            await this.plugin.saveSettings();
          })
      );
    }

    // ═══════════════════════════════════════════════════════════════════
    containerEl.createEl("h3", { text: "Knowledge Base" });

    new Setting(containerEl).setName("Dump folder")
      .setDesc("Folder within this vault for the knowledge base")
      .addText((text) => text.setPlaceholder("Dump").setValue(s.dumpFolder).onChange(async (value) => {
        s.dumpFolder = value.trim() || "Dump";
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl).setName("Auto-lint interval")
      .addDropdown((d) => d.addOption("disabled", "Disabled").addOption("daily", "Daily")
        .addOption("weekly", "Weekly").addOption("monthly", "Monthly")
        .setValue(s.lintInterval).onChange(async (v) => {
          s.lintInterval = v as DumpPlugin["settings"]["lintInterval"];
          await this.plugin.saveSettings();
          this.plugin.setupLintInterval();
        }));

    // ═══════════════════════════════════════════════════════════════════
    containerEl.createEl("h3", { text: "Safety" });

    new Setting(containerEl).setName("Max files per session")
      .setDesc("Prevents runaway processing costs")
      .addDropdown((d) => d.addOption("1", "1").addOption("3", "3").addOption("5", "5")
        .addOption("10", "10").addOption("999", "Unlimited")
        .setValue(String(s.maxFilesPerSession)).onChange(async (v) => {
          s.maxFilesPerSession = parseInt(v, 10);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl).setName("Auto-process delay")
      .setDesc("Wait after boot before processing inbox")
      .addDropdown((d) => d.addOption("0", "Disabled").addOption("0.25", "15 sec")
        .addOption("1", "1 min").addOption("5", "5 min")
        .setValue(String(s.autoProcessDelay)).onChange(async (v) => {
          s.autoProcessDelay = parseFloat(v);
          await this.plugin.saveSettings();
        }));

    // ═══════════════════════════════════════════════════════════════════
    containerEl.createEl("h3", { text: "Transcription" });

    new Setting(containerEl).setName("OpenAI API key (Whisper)")
      .setDesc(s.openaiApiKey ? "Key saved" : "Required for podcast transcription")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder("sk-...").setValue(s.openaiApiKey).onChange(async (v) => {
          s.openaiApiKey = v.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName("Whisper model")
      .addDropdown((d) => d.addOption("whisper-1", "Whisper v1").addOption("gpt-4o-transcribe", "GPT-4o Transcribe")
        .setValue(s.whisperModel).onChange(async (v) => {
          s.whisperModel = v;
          await this.plugin.saveSettings();
        }));

    // ═══════════════════════════════════════════════════════════════════
    containerEl.createEl("h3", { text: "Advanced" });

    new Setting(containerEl).setName("Max tool iterations")
      .setDesc("Safety limit for the API agent loop")
      .addText((text) => text.setPlaceholder("25").setValue(String(s.maxIterations)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!isNaN(n) && n > 0 && n <= 100) {
          s.maxIterations = n;
          await this.plugin.saveSettings();
        }
      }));
  }

  private cliStatusText(status: CliStatus, selected: CliProvider): string {
    if (selected === "none") return "No CLI. API will be used for all processing.";
    if (selected === "claude") {
      return status.claude ? `Found at ${status.claudePath}` : "Not found. Install from https://claude.ai/download";
    }
    return "Coming soon.";
  }
}

// ─── Model Fetching ─────────────────────────────────────────────────────────

async function fetchModelsFromAPI(provider: ApiProvider, apiKey: string): Promise<ModelOption[]> {
  if (provider === "anthropic") return fetchAnthropicModels(apiKey);
  return fetchOpenAIModels(apiKey);
}

async function fetchAnthropicModels(apiKey: string): Promise<ModelOption[]> {
  const response = await requestUrl({
    url: "https://api.anthropic.com/v1/models?limit=100", method: "GET",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
  });
  const models = (response.json?.data || [])
    .filter((m: { type?: string }) => m.type === "model")
    .map((m: { id: string; display_name?: string }) => ({ value: m.id, label: m.display_name || m.id }))
    .sort((a: ModelOption, b: ModelOption) => {
      const da = a.value.match(/(\d{8})/)?.[1] || "";
      const db = b.value.match(/(\d{8})/)?.[1] || "";
      return db.localeCompare(da) || a.label.localeCompare(b.label);
    });
  return models.length > 0 ? models : FALLBACK_MODELS.anthropic;
}

async function fetchOpenAIModels(apiKey: string): Promise<ModelOption[]> {
  const response = await requestUrl({
    url: "https://api.openai.com/v1/models", method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const prefixes = ["gpt-", "o1", "o3", "o4", "chatgpt-", "codex-", "gpt5"];
  const exclude = ["realtime", "audio", "transcri", "search"];
  const models = (response.json?.data || [])
    .filter((m: { id: string }) => {
      const id = m.id.toLowerCase();
      return prefixes.some((p) => id.startsWith(p)) && !exclude.some((p) => id.includes(p));
    })
    .sort((a: { created?: number }, b: { created?: number }) => (b.created || 0) - (a.created || 0))
    .map((m: { id: string }) => ({ value: m.id, label: m.id }));
  return models.length > 0 ? models : FALLBACK_MODELS.openai;
}
