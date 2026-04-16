import { App, Modal, Setting } from "obsidian";

/**
 * Modal for capturing a URL or text to dump into the knowledge base.
 */
export class DumpModal extends Modal {
  private input = "";
  private onSubmit: (input: string) => void;

  constructor(app: App, onSubmit: (input: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Dump to Knowledge Base" });

    new Setting(contentEl)
      .setName("URL or text")
      .setDesc("Paste a URL, podcast link, or text to ingest")
      .addText((text) => {
        text.inputEl.style.width = "100%";
        text
          .setPlaceholder("https://example.com/article or paste text...")
          .onChange((value) => {
            this.input = value;
          });
        // Focus the input after render
        setTimeout(() => text.inputEl.focus(), 50);
        // Submit on Enter
        text.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && this.input.trim()) {
            this.close();
            this.onSubmit(this.input.trim());
          }
        });
      });

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Dump")
        .setCta()
        .onClick(() => {
          if (this.input.trim()) {
            this.close();
            this.onSubmit(this.input.trim());
          }
        })
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
