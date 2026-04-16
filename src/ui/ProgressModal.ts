import { App, Modal, ProgressBarComponent } from "obsidian";

/**
 * Modal that shows a progress bar during long-running operations.
 * Call update() to change the message, setProgress() for the bar.
 * Call finish() when done (auto-closes after a short delay).
 */
export class ProgressModal extends Modal {
  private messageEl!: HTMLElement;
  private progressBar!: ProgressBarComponent;
  private detailEl!: HTMLElement;

  constructor(app: App) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.textAlign = "center";
    contentEl.style.padding = "20px";

    this.messageEl = contentEl.createEl("p", {
      text: "Processing...",
      attr: { style: "font-weight: 600; margin-bottom: 12px;" },
    });

    this.progressBar = new ProgressBarComponent(contentEl);
    this.progressBar.setValue(0);

    this.detailEl = contentEl.createEl("p", {
      text: "",
      attr: { style: "font-size: 0.85em; color: var(--text-muted); margin-top: 8px;" },
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /** Update the main message text */
  update(message: string): void {
    if (this.messageEl) {
      this.messageEl.setText(message);
    }
  }

  /** Update the detail text below the progress bar */
  detail(text: string): void {
    if (this.detailEl) {
      this.detailEl.setText(text);
    }
  }

  /** Set progress bar value (0-100) */
  setProgress(value: number): void {
    if (this.progressBar) {
      this.progressBar.setValue(Math.min(100, Math.max(0, value)));
    }
  }

  /** Show completion state and auto-close */
  finish(message?: string): void {
    this.update(message || "Done.");
    this.setProgress(100);
    this.detail("");
    setTimeout(() => this.close(), 2000);
  }

  /** Show error state */
  error(message: string): void {
    this.update("Error");
    this.detail(message);
    this.setProgress(0);
    // Don't auto-close on error, let user dismiss
  }
}
