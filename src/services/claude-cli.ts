import type { CliProvider, CliStatus } from "../types";

/**
 * CLI integration for wiki processing.
 * Supports Claude Code CLI and (future) GitHub Copilot CLI.
 * Runs from the vault directory so file paths are relative.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const childProcess = require("child_process") as typeof import("child_process");

export interface CliResult {
  success: boolean;
  output: string;
  costUsd?: number;
}

// ─── CLI Detection ──────────────────────────────────────────────────────────

/**
 * Detect which CLIs are available on this machine.
 */
export async function detectClis(): Promise<CliStatus> {
  const [claude, ghCopilot] = await Promise.all([
    whichCommand("claude"),
    whichCommand("gh"),
  ]);

  const status: CliStatus = {
    claude: claude !== null,
    claudePath: claude || "",
    ghCopilot: ghCopilot !== null,
    ghCopilotPath: ghCopilot || "",
  };

  console.log("Dump: CLI detection —", {
    claude: status.claude ? status.claudePath : "not found",
    gh: status.ghCopilot ? status.ghCopilotPath : "not found",
  });

  return status;
}

async function whichCommand(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    childProcess.execFile("which", [cmd], {
      env: { ...process.env, PATH: getExpandedPath() },
    }, (error: Error | null, stdout: string) => {
      resolve(!error && stdout.trim().length > 0 ? stdout.trim() : null);
    });
  });
}

// ─── CLI Execution ──────────────────────────────────────────────────────────

/**
 * Run a wiki processing task via the selected CLI.
 */
export async function runViaCli(
  cli: CliProvider,
  vaultPath: string,
  prompt: string,
  options: {
    model?: string;
    allowedTools?: string[];
  } = {}
): Promise<CliResult> {
  if (cli === "claude") {
    return runClaudeCli(vaultPath, prompt, options);
  }
  if (cli === "github-copilot") {
    return { success: false, output: "GitHub Copilot CLI integration is not yet available." };
  }
  return { success: false, output: "No CLI selected." };
}

async function runClaudeCli(
  vaultPath: string,
  prompt: string,
  options: { model?: string; allowedTools?: string[] }
): Promise<CliResult> {
  const args = [
    "--print",
    "--model", options.model || "sonnet",
    "--output-format", "json",
    "--strict-mcp-config",       // Skip all MCP servers (prevents hangs)
    "--add-dir", vaultPath,      // Give access to vault files
  ];

  if (options.allowedTools && options.allowedTools.length > 0) {
    args.push("--allowedTools", options.allowedTools.join(","));
  }

  args.push("--", prompt);

  return new Promise((resolve) => {
    // Run from /tmp (neutral dir) to avoid loading vault's .claude/ settings
    const proc = childProcess.spawn("claude", args, {
      cwd: "/tmp",
      env: { ...process.env, PATH: getExpandedPath() },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

    // Timeout
    const timeout = setTimeout(() => {
      proc.kill();
      resolve({ success: false, output: "CLI timed out after 5 minutes." });
    }, 5 * 60 * 1000);

    proc.on("close", (code: number) => {
      clearTimeout(timeout);
      if (code !== 0) {
        resolve({
          success: false,
          output: `CLI exited with code ${code}\n${stderr}`,
        });
        return;
      }

      try {
        const result = JSON.parse(stdout);
        resolve({
          success: true,
          output: result.result || result.text || stdout,
          costUsd: result.cost_usd,
        });
      } catch {
        resolve({ success: true, output: stdout });
      }
    });

    proc.on("error", (err: Error) => {
      clearTimeout(timeout);
      resolve({ success: false, output: `CLI spawn error: ${err.message}` });
    });
  });
}

// ─── Prompt Builder ─────────────────────────────────────────────────────────

export function buildIngestPrompt(
  dumpFolder: string,
  rawFilePath: string
): string {
  return `You are a wiki maintainer for an Obsidian knowledge base.

The Dump folder is: ${dumpFolder}/
Read the file at "${rawFilePath}".

If the file contains a URL to extract (look for "Extract and ingest:" in the body):
1. Extract the article using: trafilatura -u "URL" --formatting --links --markdown --with-metadata
   If trafilatura returns empty, try: defuddle "URL"
   If both fail, use WebFetch as last resort.
2. Update the raw file: replace the "Extract and ingest:" line with the full extracted content. Add title, author, description to the frontmatter.

Then create wiki pages from the content.

RULES:
- Create 2-4 substantial wiki pages (300+ words each) in ${dumpFolder}/wiki/
- Every claim must cite its source: [Source: filename.md]
- Use [[wikilinks]] for cross-references between wiki pages
- Check existing wiki pages in ${dumpFolder}/wiki/ before creating new ones. UPDATE existing pages if relevant.
- NEVER create near-duplicate pages
- No H1 headings (Obsidian uses filename as title)
- Update ${dumpFolder}/wiki/index.md with any new pages
- Do NOT create a new raw file. The source is already saved.

MANDATORY LAST STEP — Append to ${dumpFolder}/wiki/log.md:
## [YYYY-MM-DD] ingest | Article Title
- Source: [[raw/filename]]
- Wiki pages created: [[page1]], [[page2]]
- Wiki pages updated: [[page3]]
- Tags: tag1, tag2

Wiki page frontmatter template:
---
title: "Topic Name"
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
source_count: N
status: draft
tags:
  - relevant-tag
---`;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getExpandedPath(): string {
  const base = process.env.PATH || "";
  const extras = [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    `${process.env.HOME}/.local/bin`,
    `${process.env.HOME}/.npm-global/bin`,
    `${process.env.HOME}/.nvm/versions/node/current/bin`,
  ];
  return [...new Set([...extras, ...base.split(":")])].join(":");
}
