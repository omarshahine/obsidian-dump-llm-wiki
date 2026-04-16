import { App, TFile, normalizePath, requestUrl } from "obsidian";
import type { ToolResult } from "../types";

/**
 * Executes a tool call against the Obsidian Vault API.
 * All paths are relative to vault root; the dump folder prefix
 * is handled by the agent (it knows the configured folder name).
 */
export async function executeTool(
  app: App,
  toolName: string,
  input: Record<string, unknown>,
  dumpFolder: string
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case "read_file":
        return await readFile(app, input);
      case "create_file":
        return await createFile(app, input);
      case "update_file":
        return await updateFile(app, input);
      case "search_files":
        return await searchFiles(app, input, dumpFolder);
      case "list_files":
        return await listFiles(app, input, dumpFolder);
      case "fetch_url":
        return await fetchUrl(input);
      case "get_backlinks":
        return await getBacklinks(app, input);
      case "get_current_datetime":
        return getCurrentDatetime();
      default:
        return { result: `Unknown tool: ${toolName}`, isError: true };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { result: `Tool error: ${msg}`, isError: true };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function ensureParentFolder(app: App, filePath: string): Promise<void> {
  const parentPath = filePath.substring(0, filePath.lastIndexOf("/"));
  if (parentPath && !app.vault.getFolderByPath(parentPath)) {
    await app.vault.createFolder(parentPath);
  }
}

// ─── Tool Implementations ───────────────────────────────────────────────────

async function readFile(
  app: App,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const path = input.path as string;
  if (!path) {
    return { result: "'path' parameter is required.", isError: true };
  }

  const file = app.vault.getFileByPath(normalizePath(path));
  if (!file) {
    return { result: `File not found: ${path}`, isError: true };
  }

  const content = await app.vault.cachedRead(file);
  return { result: content, isError: false };
}

async function createFile(
  app: App,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const path = normalizePath(input.path as string);
  const content = input.content as string;

  if (!path) {
    return { result: "'path' parameter is required.", isError: true };
  }

  if (app.vault.getFileByPath(path)) {
    return {
      result: `File already exists: ${path}. Use update_file to modify it.`,
      isError: true,
    };
  }

  await ensureParentFolder(app, path);
  await app.vault.create(path, content || "");
  return { result: `Created ${path}.`, isError: false };
}

async function updateFile(
  app: App,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const path = normalizePath(input.path as string);
  const operation = input.operation as string;
  const content = input.content as string;
  const find = input.find as string | undefined;

  if (!path) {
    return { result: "'path' parameter is required.", isError: true };
  }

  const file = app.vault.getFileByPath(path);
  if (!file) {
    return { result: `File not found: ${path}`, isError: true };
  }

  switch (operation) {
    case "replace_all":
      await app.vault.modify(file, content);
      return { result: `Replaced all content in ${path}.`, isError: false };

    case "find_replace": {
      if (!find) {
        return { result: "'find' parameter is required for find_replace.", isError: true };
      }
      let found = false;
      await app.vault.process(file, (data) => {
        const idx = data.indexOf(find);
        if (idx === -1) {
          found = false;
          return data;
        }
        found = true;
        return data.substring(0, idx) + content + data.substring(idx + find.length);
      });
      if (!found) {
        return {
          result: "Could not find the specified text. Make sure it matches exactly.",
          isError: true,
        };
      }
      return { result: `Replaced text in ${path}.`, isError: false };
    }

    case "append":
      await app.vault.process(file, (data) => data + "\n" + content);
      return { result: `Appended to ${path}.`, isError: false };

    default:
      return { result: `Unknown operation: ${operation}`, isError: true };
  }
}

async function searchFiles(
  app: App,
  input: Record<string, unknown>,
  dumpFolder: string
): Promise<ToolResult> {
  const query = (input.query as string).toLowerCase();
  const subfolder = input.folder as string | undefined;
  const limit = Math.min((input.limit as number) || 20, 50);

  const prefix = subfolder
    ? normalizePath(`${dumpFolder}/${subfolder}`)
    : normalizePath(dumpFolder);

  const files = app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(prefix + "/"));
  const results: string[] = [];

  for (const file of files) {
    if (results.length >= limit) break;

    if (file.path.toLowerCase().includes(query)) {
      results.push(`- ${file.path}`);
      continue;
    }

    const content = await app.vault.cachedRead(file);
    const lowerContent = content.toLowerCase();
    const idx = lowerContent.indexOf(query);
    if (idx !== -1) {
      const start = Math.max(0, idx - 60);
      const end = Math.min(content.length, idx + query.length + 60);
      const snippet = content.substring(start, end).replace(/\n/g, " ");
      results.push(`- ${file.path}: ...${snippet}...`);
    }
  }

  if (results.length === 0) {
    return { result: `No results found for "${input.query}".`, isError: false };
  }

  return {
    result: `Found ${results.length} result(s):\n${results.join("\n")}`,
    isError: false,
  };
}

async function listFiles(
  app: App,
  input: Record<string, unknown>,
  dumpFolder: string
): Promise<ToolResult> {
  const subfolder = input.folder as string | undefined;
  const prefix = subfolder
    ? normalizePath(`${dumpFolder}/${subfolder}`)
    : normalizePath(dumpFolder);

  const files = app.vault
    .getFiles()
    .filter((f) => f.path.startsWith(prefix + "/"))
    .map((f) => f.path)
    .sort();

  const capped = files.slice(0, 200);
  const suffix = files.length > 200 ? `\n\n(Showing 200 of ${files.length} files)` : "";

  if (capped.length === 0) {
    return { result: "No files found.", isError: false };
  }

  return {
    result: capped.map((p) => `- ${p}`).join("\n") + suffix,
    isError: false,
  };
}

async function getBacklinks(
  app: App,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const path = input.path as string;
  if (!path) {
    return { result: "'path' parameter is required.", isError: true };
  }

  const file = app.vault.getFileByPath(normalizePath(path));
  if (!file) {
    return { result: `File not found: ${path}`, isError: true };
  }

  const allLinks = app.metadataCache.resolvedLinks;
  const backlinks: string[] = [];

  for (const [sourcePath, targets] of Object.entries(allLinks)) {
    if (targets[file.path]) {
      backlinks.push(sourcePath);
    }
  }

  if (backlinks.length === 0) {
    return { result: `No backlinks found for ${path}.`, isError: false };
  }

  backlinks.sort();
  return {
    result: `${backlinks.length} note(s) link to ${path}:\n${backlinks.map((p) => `- ${p}`).join("\n")}`,
    isError: false,
  };
}

async function fetchUrl(input: Record<string, unknown>): Promise<ToolResult> {
  const url = input.url as string;
  if (!url) {
    return { result: "'url' parameter is required.", isError: true };
  }

  try {
    const response = await requestUrl({ url, method: "GET" });
    const html = response.text;

    // Extract metadata
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "";

    const authorMatch = html.match(/name=["']author["'][^>]*content=["']([^"']+)/i)
      || html.match(/property=["']article:author["'][^>]*content=["']([^"']+)/i);
    const author = authorMatch ? authorMatch[1].trim() : "";

    // Strip to article text: remove scripts, styles, nav, headers, footers, then tags
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Cap at ~50K chars to avoid blowing up the context
    const capped = text.length > 50000 ? text.substring(0, 50000) + "\n\n[Content truncated]" : text;

    return {
      result: `Title: ${title}\nAuthor: ${author}\nURL: ${url}\n\n${capped}`,
      isError: false,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { result: `Failed to fetch ${url}: ${msg}`, isError: true };
  }
}

function getCurrentDatetime(): ToolResult {
  const now = new Date();
  const iso = now.toISOString();
  const dateOnly = iso.split("T")[0];
  const local = now.toLocaleString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  return {
    result: `Local: ${local}\nISO: ${iso}\nDate: ${dateOnly}`,
    isError: false,
  };
}
