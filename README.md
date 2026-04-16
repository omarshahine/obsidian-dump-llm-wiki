# Dump (LLM Wiki)

An Obsidian plugin that implements Karpathy's LLM Wiki concept. Dump URLs, podcasts, and text into a cross-linked knowledge base maintained by AI.

Based on [Andrej Karpathy's idea](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f): instead of bookmarking and searching, have an AI maintain a living wiki that synthesizes everything you capture.

## How It Works

1. You dump a URL, podcast, or text
2. The plugin extracts the content (Readability for articles, Whisper for podcasts)
3. An AI agent saves the raw source, creates wiki pages, adds cross-references, updates the index
4. Every new dump makes the whole knowledge base smarter

## Commands

| Command | Description |
|---------|-------------|
| Dump URL | Opens modal for URL or text input |
| Dump clipboard | Grabs clipboard content and ingests |
| Dump selection | Dumps selected text from the active note |
| Query knowledge base | Search and synthesize answers from dumped content |
| Lint wiki | Audit for orphans, broken links, contradictions |
| Show status | Display KB stats (sources, pages, categories) |

## Settings

- **Provider**: Anthropic (Claude) or OpenAI (GPT-4)
- **Model**: Select or enter a custom model ID
- **API key**: Stored securely in OS keychain (not synced)
- **Dump folder**: Configurable folder name (default: "Dump")
- **Auto-lint**: Scheduled health checks (daily/weekly/monthly)
- **Whisper**: OpenAI API key and model for podcast transcription

## Vault Structure

```
Dump/
├── raw/            # Immutable source captures (YYYY-MM-DD-slug.md)
│   └── assets/     # Images, screenshots
├── wiki/           # AI-maintained wiki pages (slug.md)
│   ├── index.md    # Master index by category
│   └── log.md      # Chronological operation log
└── outputs/        # Reports, query answers, lint results
```

## Build

```bash
npm install
npm run build    # Production
npm run dev      # Watch mode
```

## Credits

Inspired by [Andrej Karpathy's LLM Wiki](https://x.com/karpathy/status/2039805659525644595) concept.
