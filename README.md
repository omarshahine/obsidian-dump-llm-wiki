# Dump (LLM Wiki)

An Obsidian plugin that turns dumped URLs, podcasts, and text into a cross-linked wiki maintained by an AI agent.

Based on [Andrej Karpathy's LLM Wiki idea](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f): instead of bookmarking and searching, have an AI maintain a living knowledge base that synthesizes everything you capture.

## Philosophy

Bookmarking is a graveyard. You save articles, podcasts, and notes "for later" and never read them again. Search is barely better — you have to remember the right keywords years after the fact.

Dump flips it: every capture goes through an AI agent that reads the source, distills the key ideas, drops them into wiki pages, and cross-links them with everything else you've ever dumped. The wiki gets smarter every time you feed it. You ask questions of *your own* knowledge base and get answers grounded in your sources.

## How it works

1. You dump a URL, a podcast link, or some text.
2. The plugin extracts the content (Readability for articles, Whisper for podcasts).
3. An AI agent saves the raw source, creates or updates wiki pages, and cross-references them.
4. The index and log are updated automatically.

## Commands

| Command | Description |
|---------|-------------|
| Dump URL | Open a modal to paste a URL or text |
| Dump clipboard | Grab clipboard content and ingest |
| Dump selection | Dump selected text from the active note |
| Query knowledge base | Search and synthesize answers from dumped content |
| Lint wiki | Audit for orphans, broken links, and contradictions |
| Process inbox | Manually process queued inbox files |
| Show status | Display KB stats (sources, pages, categories) |

## Vault structure

```
Dump/
├── inbox/          # New captures, awaiting processing
├── raw/            # Immutable source captures (YYYY-MM-DD-slug.md)
│   └── assets/     # Images, screenshots
├── wiki/           # AI-maintained wiki pages (slug.md)
│   ├── index.md    # Master index by category
│   └── log.md      # Chronological operation log
└── outputs/        # Reports, query answers, lint results
```

Raw files are immutable. Wiki pages are living documents that grow as you add more sources. Every claim cites its source.

## Install

### Via BRAT (recommended for now)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from Community Plugins
2. In BRAT settings, click "Add Beta plugin"
3. Enter: `omarshahine/obsidian-dump-llm-wiki`
4. Enable the plugin in Community Plugins

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release
2. Create `<vault>/.obsidian/plugins/dump-llm-wiki/`
3. Copy the files there
4. Enable in Community Plugins

## Setup

Pick one of two modes — they're not mutually exclusive, you can configure both and the plugin will fall back from CLI to API if needed.

### CLI mode (recommended)

If you have [Claude Code](https://claude.ai/download) installed, the plugin will shell out to it for processing. This is the default and the most powerful option — Claude Code can use Read, Write, Edit, Glob, Grep, Bash, and WebFetch to maintain the wiki.

1. Install Claude Code
2. In Settings > Dump LLM Wiki, set "CLI tool" to Claude
3. Pick a model (Opus, Sonnet, or Haiku)

No API key required. The plugin auto-detects the CLI on macOS, including Homebrew and nvm install paths.

### API mode

If you'd rather use the Anthropic or OpenAI API directly:

1. Open Settings > Dump LLM Wiki
2. Pick Anthropic or OpenAI
3. Enter your API key (stored per-provider in your OS keychain via SecretStorage, never synced)
4. Click the refresh icon next to Model to load available models from the API

### Optional: podcast transcription

To dump podcasts, add an OpenAI API key under "Transcription". Whisper or `gpt-4o-transcribe` will transcribe the audio before ingest.

## Settings

| Setting | What it does |
|---------|--------------|
| CLI tool | Claude Code is the primary processor when installed |
| CLI model | Opus, Sonnet, or Haiku — passed to Claude Code |
| Provider | Anthropic or OpenAI for API fallback |
| API key | Stored in OS keychain, never in `data.json` |
| Dump folder | Folder name within your vault (default: `Dump`) |
| Auto-lint interval | Disabled, daily, weekly, or monthly health checks |
| Max files per session | Safety cap to prevent runaway processing costs |
| Auto-process delay | Wait after Obsidian boot before processing the inbox |
| Whisper model | `whisper-1` or `gpt-4o-transcribe` |
| Max tool iterations | Safety limit for the API agent loop |

## Design decisions

| Decision | Why |
|----------|-----|
| Inbox/raw split | Captures land in `inbox/` instantly, then move to `raw/` after processing. Raw is immutable; the inbox is your queue. |
| CLI before API | Claude Code has more capabilities (Bash, WebFetch with extraction tools) and lower latency. API is the fallback. |
| Per-provider API keys | Stored in OS keychain via Obsidian's [SecretStorage](https://docs.obsidian.md/plugins/guides/secret-storage). Never synced, never in `data.json`. |
| Two API providers | Anthropic and OpenAI cover the best models. No bloat. |
| Session caps | Prevents one runaway dump from torching your API budget. |
| Desktop only | The CLI integration uses Node `child_process`, which isn't available on mobile. |

## Development

```bash
git clone https://github.com/omarshahine/obsidian-dump-llm-wiki.git
cd obsidian-dump-llm-wiki
npm install
npm run dev    # Watch mode
npm run build  # Production build
```

Symlink into your vault for testing:

```bash
ln -s /path/to/obsidian-dump-llm-wiki /path/to/vault/.obsidian/plugins/dump-llm-wiki
```

## Credits

Inspired by [Andrej Karpathy's LLM Wiki](https://x.com/karpathy/status/2039805659525644595) concept.

## License

MIT
