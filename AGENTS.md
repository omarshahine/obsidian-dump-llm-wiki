## Clawpatch Code Review

This repo uses [Clawpatch](https://clawpatch.ai) for local automated code review. Keep `.clawpatch/` ignored; it is generated runtime state containing features, findings, reports, runs, and patch attempts.

Standard workflow:

```bash
clawpatch doctor
clawpatch init          # first time only
clawpatch map
clawpatch review --limit 10
clawpatch report --output .clawpatch/reports/summary.md
clawpatch show --finding <id>
clawpatch fix --finding <id>
clawpatch revalidate --finding <id>
```

If this repo needs hand-authored feature coverage, keep those curated definitions in `tools/clawpatch/features/` and sync/copy them into `.clawpatch/features/` before review. Do not commit `.clawpatch/` generated state.


<!-- BEGIN CLAUDE MEMORY IMPORT: -Users-omarshahine-GitHub-obsidian-dump-llm-wiki -->
## Imported Claude Project Memory

Durable memory promoted from `~/.claude/projects/-Users-omarshahine-GitHub-obsidian-dump-llm-wiki/memory` during the AGENTS.md migration. Keep this section current when project-specific operating knowledge changes.

### memory/MEMORY.md

- [Personal URLs](user_personal_url.md) — manifest.json: github.com/omarshahine; bylines: omarknows.app; never omarshahine.com

### memory/user_personal_url.md

---
name: Personal URLs (manifests vs. content)
description: Which URLs to use for plugin manifests vs. bylines/content links
type: user
originSessionId: 768e3102-b421-44d8-8736-70822e7415f7
---
Omar's URL preferences:

- **Plugin `manifest.json` `authorUrl`**: use **`https://github.com/omarshahine`** (GitHub profile).
- **Bylines, "the author's site," or content links**: use **`https://omarknows.app`**.
- **Do NOT use `omarshahine.com`** — it is not his site, despite older plugin manifests (e.g. obsidian-chat) referencing it. Treat that as legacy/stale.

<!-- END CLAUDE MEMORY IMPORT: -Users-omarshahine-GitHub-obsidian-dump-llm-wiki -->
