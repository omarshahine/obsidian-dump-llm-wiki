import type { UnifiedToolDef } from "../types";

/**
 * Tools available to the dump agent for wiki maintenance.
 * Focused on knowledge base operations: read, create, update, search, index, log.
 */
export const TOOL_DEFINITIONS: UnifiedToolDef[] = [
  {
    name: "read_file",
    description: "Read the full content of a file in the vault by its path.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file relative to vault root.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "create_file",
    description:
      "Create a new file in the vault. Fails if the file already exists. The filename is the title in Obsidian, so never start content with an H1 heading that repeats the filename.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Path for the new file relative to vault root (e.g. 'Dump/raw/2026-04-08-karpathy-wiki.md').",
        },
        content: {
          type: "string",
          description: "Content of the new file.",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "update_file",
    description:
      "Update an existing file. Supports 'replace_all' (full rewrite), 'find_replace' (surgical edit), or 'append' (add to end).",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file relative to vault root.",
        },
        operation: {
          type: "string",
          enum: ["replace_all", "find_replace", "append"],
          description: "The type of edit to perform.",
        },
        content: {
          type: "string",
          description:
            "The new content (replace_all), replacement text (find_replace), or text to append.",
        },
        find: {
          type: "string",
          description: "The exact text to find (required for find_replace).",
        },
      },
      required: ["path", "operation", "content"],
    },
  },
  {
    name: "search_files",
    description:
      "Search for files in the Dump folder by filename or content. Returns matching file paths and snippets.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (matched against filenames and content).",
        },
        folder: {
          type: "string",
          enum: ["raw", "wiki", "outputs"],
          description: "Subfolder to search within. Omit to search all of Dump/.",
        },
        limit: {
          type: "number",
          description: "Maximum results to return. Default: 20.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_files",
    description: "List files in a Dump subfolder.",
    inputSchema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          enum: ["raw", "wiki", "outputs"],
          description: "Subfolder to list. Omit to list all of Dump/.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_backlinks",
    description:
      "Find all notes that link to a given file. Uses Obsidian's metadata cache.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "fetch_url",
    description:
      "Fetch a URL and return the page content as text. Strips HTML tags, scripts, styles, and navigation. Use this to extract article content from URLs found in inbox files.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "get_current_datetime",
    description:
      "Get the current date and time. Use for timestamps in raw files and log entries.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];
