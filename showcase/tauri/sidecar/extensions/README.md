# Roamies fork extensions

Custom features that live **outside** upstream Roamies core so merges from
`KenKaiii/Roamies` are safer.

## What’s here

- **Voice chain** — ElevenLabs → Cartesia → Microsoft Azure Speech → macOS `say`
  (reorderable), plus OpenRouter speech models
- **Self-configure** — the agent can change a *whitelist* of settings when you ask
  (not arbitrary source edits)
- **Update guard** — with `protectExtensions: true` (default on this fork),
  in-app updates notify only and do not replace the app automatically

## Merging upstream without losing this

```bash
git remote add upstream https://github.com/KenKaiii/Roamies.git   # once
git fetch upstream
git merge upstream/main
# Resolve conflicts; keep everything under showcase/tauri/sidecar/extensions/
# and the small hooks in sidekick.mjs / speaker.mjs / panel.js marked EXTENSION.
```

Config and keys stay in `~/.gg/` and are never overwritten by git or updates.

## Rebuild after changes

```bash
cd showcase/tauri
(cd sidecar && npm ci && npm test && ./bundle.sh)
./build.sh          # or: cargo tauri build --debug --bundles app
```
