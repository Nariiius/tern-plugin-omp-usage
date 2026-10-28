# tern-plugin-omp-usage

Compact provider quota icons between the native session cost and Stop in [Tern](https://stencil.so/tern), with a theme-colored divider before the quota control. No extra line.

Hover the quota icons for full provider names, quota windows, remaining percentages, reset countdowns and saved resets. The native cost control and its tooltip remain separate and unchanged. Console's Queue action has its own theme-colored divider after quota.

![The hover card: Claude's 5-hour and weekly windows with meters, reset times and a saved reset's expiry date](docs/images/card-current.png)

- Shows the limits for the active model's provider (any provider `omp usage` reports: Claude, Codex, Kimi,
  Gemini, Muse Code, …), and switches within about 2 s when you change models (Alt+P). While you view a subagent's
  transcript, it shows the limits for that subagent's model. Providers and windows come from omp's report, so a
  new provider or an unfamiliar window (labeled by its length, e.g. `2h`) shows without changes here.
- Or shows every provider at once, or the ones you choose, in the order you set (see [Settings](#settings)).
- Combines all reported accounts using omp's native Usage overview rules; independent model/tier pools stay separate.
- Prioritizes 5-hour, weekly, then monthly quota. Exhausted limits stay visible beside the next window; the hover card retains all independent pools.
- Preserves Ponytail and other extension statuses in their native bottom-bar positions. Inactive panes retain their native cost fitting and font.
- Click the quota icons to open omp's normal Usage overview, including during a turn and without changing drafts or attachments.
- Provider icons take the provider color, amber at 25% or less and red at 10% or less.
- Hover surfaces use Tern's popover background, text, border and radius tokens, without a provider-colored glow or title-band tint. Icons have a non-breaking gap before their percentages and wider gaps between providers.
- Configure providers, order and colors through the **omp Usage: Settings** command. No default shortcut or extra Tern status-bar item is registered.

| Part | What it does |
| --- | --- |
| `omp/extensions/usage-remaining.js` | Tern-only omp extension. Seeds quota status from fresh cache, fetches `omp usage --json` in the background, and maintains every model's and provider's cached line. Ordinary omp terminal sessions publish no quota status and start no collector timers. |
| `omp-usage/` | Tern plugin. Reads quota data and the cache, styles the dedicated quota item, adds Console's Queue divider, and supplies quota-only hover details and command-palette settings. |

The local integration was verified on macOS with Tern 0.9.5 and the linked omp source checkout, including Console chat style, Amethyst, program colors, expanded thoughts and the plain-text composer.

## Requirements

- Tern, with plugins on (Preferences › Plugins).
- omp, signed in to an account with usage limits (Anthropic, OpenAI Codex, …). `omp usage` should list them.
- An omp installation exposing its public usage helper modules through the CLI installation (the linked/source install is supported).
- The local omp composer integration exposing `ComposerFacts.providerUsage` / `omp.composer.provider-usage`. The quota item is a separate control; the stock session-cost implementation is not changed.

## Install

Run the commands from the folder you cloned into. In paths, prefer forward slashes, even on Windows: they work
in every shell, while unquoted backslashes break in bash-style shells.

### 1. Get the repo

Clone it to a folder you'll keep. Tern and omp load the files from there.

```sh
git clone https://github.com/jmazzola/tern-plugin-omp-usage.git
cd tern-plugin-omp-usage
```

### 2. Link the Tern plugin

```sh
tern plugin link ./omp-usage
tern plugin list
```

`tern plugin list` should show `omp-usage … ready`. The link persists: Tern loads the plugin on every launch.

### 3. Load the omp extension

Add the extension's full path to `~/.omp/agent/config.yml`, or add the line to your existing `extensions:` list.
Replace `/path/to/tern-plugin-omp-usage` with where you cloned it (e.g. `C:/Users/you/tern-plugin-omp-usage`):

```yaml
extensions:
  - /path/to/tern-plugin-omp-usage/omp/extensions/usage-remaining.js
```

### 4. Let omp show extension statuses

The extension's line reaches the composer bar as an extension status, where the plugin reads it (and hides it
from the focused pane's bar; the rest of your status line, such as branch and git changes, stays, and the session
cost is kept even when a long status line, like the `full` preset, fills the bar). Either keep `showHookStatus`
on, which works with any status line preset:

```yaml
statusLine:
  showHookStatus: true
```

or, with `preset: custom`, list the `status` segment:

```yaml
statusLine:
  leftSegments:
    - status   # alongside your other segments
```

### 5. Restart omp

Restart every omp pane when convenient; running processes cannot load the new native quota item or the updated extension in place. No running pane is restarted automatically. All collectors share a cache, so an old process can otherwise overwrite combined-account values with its old calculation.

## Check it works

Focus a restarted native omp pane. Compact provider icons and percentages appear after session cost and before Stop. A fresh shared cache is published synchronously, without waiting for a provider request; without cached data, the first request must finish before real percentages can appear. Hover shows quota details; clicking opens the normal Usage view. Unfocused panes keep native cost behavior and hide the plugin's quota item. Ordinary terminal rendering, even inside Tern, does not enable the collector: activation follows the live native Surface Protocol capability.

## Settings

Run **omp Usage: Settings** from Tern's command palette. It opens beside the focused pane; opening it again focuses the existing panel. **omp Usage: Quick options** offers the existing mode, provider and color pickers. No default key binding is installed.

| Section | What it does |
| --- | --- |
| Bar preview | The same compact icons, percentages and enabled-window priority as the actual bottom bar |
| Show | **Current model**: the focused agent's provider. **All providers**: every provider reporting limits. **Selected providers**: providers enabled under Providers |
| Providers | A row per provider, in the line's order. Its switch puts it in or takes it out of Selected providers, and shows those; its arrows move it one place, **top** moves it first |
| Quota windows | Independent **Bar** and **Hover** switches for each provider's reported quota pool, including separate model/tier pools. Hide monthly in Hover without changing Bar, or vice versa |
| Colors | Per provider: its preset, a named alternative (Ember, Sunset, Moss, Ocean, Orchid, Slate, Theme accent), **Custom…** (one or two hex colors, like `#d97757` or `#9aa7b4, #5b8def`) and **Reset**. Point at a swatch for its name |

![The settings panel: a line preview, the Show choices, providers with switches and move buttons, and color swatches](docs/images/settings-panel.png)

Changes redraw the settings canvas immediately, without waiting for its poll timer or rereading another pane's surface. Fresh collector data also triggers a refresh immediately. Preferences persist across reloads and are shared by Tern windows. Provider order uses the existing buttons.

Cheap focus/settings checks run every 500 ms. Bounded dock observations run separately every 2 s, and shared-cache reads are asynchronous every 3 s; a changed cache queues a redraw as soon as the read completes. Surface discovery, cache completion, bar painting and settings painting use separate callbacks so one combined refresh does not consume Tern's 50 ms hook budget.

Bar priority remains **5h → weekly → monthly** among enabled windows; exhausted enabled limits remain visible beside the next one. If all Bar windows for a provider are disabled, its icon is hidden. Hover choices affect only the plugin's card, not the normal Usage overview. A choice for a generic monthly/weekly window carries over to named pools if the report later becomes more detailed; an explicit pool choice overrides it.

**omp Usage: Quick options** offers the existing mode, provider, ordering and color pickers. Per-window Bar/Hover choices are in the settings panel.

The presets: Claude clay, Codex graphite to blue, OpenAI green, Kimi green, Gemini blue to white, Antigravity
blue, MiniMax red to pink, Go cyan, Qwen purple, Devin teal. Other providers use the theme's accent. Whatever
a provider's colors, a window at 25% or less turns amber and one at 10% or less red.

### What each choice looks like

**Current model** (the default) shows the focused agent's provider, as at the top of this page.

**All providers** shows every provider with quota data, in your order, using compact icons and percentages. The hover card shows the provider names and enabled Hover windows:

![All providers: Claude and Codex on one line, with a card listing both providers' windows and saved resets](docs/images/card-all.png)

**Selected providers** shows only the ones switched on, here Codex while an Opus model is in use:

![Selected providers: only Codex's weekly window on the line](docs/images/line-selected.png)

**Colors**: Claude on the Sunset alternative and Codex on a custom `#22d3ee, #a78bfa`:

![Custom colors: Claude in a red-orange gradient and Codex in cyan to violet, on the line and in the card](docs/images/card-colors.png)

### The usage cache

The extension maintains `~/.omp/cache/usage-remaining.json`: each model's line, keyed by the name omp's model chip shows, each provider's plan-wide line, and the expiry dates of saved resets. The plugin uses it for a viewed subagent's model, for All and Selected providers, and for the reset dates in the card.

New native sessions immediately reuse a cache younger than 10 minutes. Provider collection runs every 30 s and after turns; simultaneous refresh triggers share one in-flight request, and the model inventory is reused. Model switches are checked every second. Startup and turn hooks do not wait for provider requests. Failed requests keep the last good data without extending its age; expired data is hidden rather than presented as current.

The extension resolves public helpers from the active CLI installation, not a second dependency copy beside the extension, so its native capability flag belongs to the running omp UI. Restart older omp sessions when convenient to load this behavior; no running session is restarted automatically.

## Update

From the repo folder:

```sh
git pull
tern plugin reload
```

Then restart omp sessions if the extension changed.

## Turn it off or uninstall

| To | Do |
| --- | --- |
| Turn the Tern plugin off | `tern plugin unlink omp-usage`, or switch it off in Preferences › Plugins |
| Turn it back on | `tern plugin link ./omp-usage`, from the repo folder |
| Remove the extension | Delete its line from `~/.omp/agent/config.yml`, then restart omp |

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `tern plugin list` doesn't show `ready` | It prints the error. Tern's log on Windows: `%LOCALAPPDATA%\Tern\Logs\tern.log` |
| No quota icons beside cost | Icons show only in the focused omp pane, for selected providers with data and at least one enabled Bar window. Restart an older pane to load the separate quota control; settings show a notice when that control is missing |
| Provider windows keep changing | Old collector processes can overwrite the shared cache with less detailed reports. Restart every old omp collector when convenient |
| Settings stop responding | Check Tern's log for a disabled plugin hook, then run `tern plugin reload`. Changes no longer depend on the periodic timer or an agent-surface read |
| Line stopped after an omp or Tern update | omp may have renamed what the plugin reads. Ask omp to fix `omp-usage` |
| Edits to `window.luau` don't show | Run `tern plugin reload` |

Don't edit Tern's `settings.json` from PowerShell. It saves the file with a BOM, and Tern falls back to its
default settings until the file is restored.
