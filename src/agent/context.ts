import { App, normalizePath } from "obsidian";

/**
 * Builds a context string describing the current state of the Dump knowledge base.
 * Injected into the user message (not the system prompt) so the system prompt
 * stays cache-friendly.
 */
export function buildDumpContext(app: App, dumpFolder: string): string {
  const prefix = normalizePath(dumpFolder);
  const allFiles = app.vault.getMarkdownFiles();

  const rawFiles = allFiles.filter((f) => f.path.startsWith(`${prefix}/raw/`));
  const wikiFiles = allFiles.filter(
    (f) => f.path.startsWith(`${prefix}/wiki/`) && !f.path.endsWith("index.md") && !f.path.endsWith("log.md")
  );
  const outputFiles = allFiles.filter((f) => f.path.startsWith(`${prefix}/outputs/`));

  const parts: string[] = [
    `[Dump KB Context: ${rawFiles.length} raw sources, ${wikiFiles.length} wiki pages, ${outputFiles.length} outputs.`,
    `Dump folder: "${dumpFolder}".`,
  ];

  if (wikiFiles.length > 0) {
    const pageNames = wikiFiles
      .map((f) => f.basename)
      .sort()
      .slice(0, 30);
    parts.push(`Wiki pages: ${pageNames.join(", ")}${wikiFiles.length > 30 ? "..." : ""}.`);
  }

  parts.push("]");
  return parts.join(" ");
}
