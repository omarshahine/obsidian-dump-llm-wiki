import { App, Modal, Setting } from "obsidian";

/**
 * Modal for querying the knowledge base.
 */
export class QueryModal extends Modal {
  private input = "";
  private onSubmit: (question: string) => void;

  constructor(app: App, onSubmit: (question: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Query Knowledge Base" });

    new Setting(contentEl)
      .setName("Question")
      .setDesc("Ask a question about your dumped content")
      .addText((text) => {
        text.inputEl.style.width = "100%";
        text
          .setPlaceholder("What do I know about...?")
          .onChange((value) => {
            this.input = value;
          });
        setTimeout(() => text.inputEl.focus(), 50);
        text.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && this.input.trim()) {
            this.close();
            this.onSubmit(this.input.trim());
          }
        });
      });

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Search")
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
