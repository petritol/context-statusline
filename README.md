# context-statusline

![Sample states with contextBudget set to 75%](docs/states.svg)

A [Claude Code mod](https://claude.com/blog/claude-code-mods) that shows
**context-window usage** at a glance — a colorized percentage, a Unicode
progress bar, and a `used / total` token count — in a band just above the
prompt. It also shows your session (5-hour) and weekly usage limits, with how
long until each one resets.

The color runs green → yellow → red as the context fills — fully red at 200k
tokens by default, or at a point you [configure](#configuration). The bar's
empty cells preview that gradient in a darker shade, and a `│` in the current
color marks where the budget is reached (`┃` once the fill has passed it).
The line is drawn on a black background so the colors read on light themes
too.

Each section colors itself. The model, project and separators are neutral
gray. The session and weekly limits run green → yellow at 50% → red at 100%,
and that point is not configurable. Their bars are half the width of the
context bar, with no budget marker.

As the terminal narrows, the bars shrink, then drop out, then the week limit
goes, then the session limit, and finally the project name.

## Requirements

- **Claude Code with mod support** (function-hook plugins). Tested on v2.1.303.
- A **UTF-8 terminal** (for the `█` / `░` bar glyphs) with **truecolor** support
  for the gradient (virtually all modern terminals qualify).

The band draws in the terminal and in the desktop app's Code tab.

Usage limits appear only on a Claude subscription, and only after the session's
first reply. The countdown refreshes each minute without making API calls or
using tokens.

## Installation

Install it from the [petritol](https://github.com/petritol/claude-plugins)
plugin marketplace:

```
/plugin marketplace add petritol/claude-plugins
/plugin install context-statusline@petritol
```

The band appears above the prompt and updates after each turn.

### From a local clone

```sh
git clone https://github.com/petritol/context-statusline
claude --plugin-dir /path/to/context-statusline
```

To load it in every session without the flag, add the folder to the `env`
block of `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/context-statusline"
  }
}
```

### Upgrading from the status line script

Earlier versions were a `statusLine` command script. Remove the `statusLine`
block from `~/.claude/settings.json` and delete
`~/.claude/statusline-context.js`, or the usage shows twice.

## Configuration

`contextBudget` sets the usage at which the color turns fully red; it passes
yellow at three quarters of that point. Give it a token count to keep the
gradient on fixed numbers, or a share of the context window to scale it with
whatever window the session has. The default is `200k`.

| Format       | Example          | Means                                      |
| ------------ | ---------------- | ------------------------------------------ |
| Plain number | `120000`         | 120,000 tokens                             |
| `k` suffix   | `200k`, `150.5k` | thousands of tokens                        |
| `M` suffix   | `1M`, `1.5M`     | millions of tokens                         |
| `%` suffix   | `80%`, `62.5%`   | that share of the session's context window |

- Decimals are allowed, `k` and `M` work in either case, and spaces around
  the value or before the unit are ignored.
- A percentage follows the session's window: `80%` is 160k on a 200k window
  and 800k on a 1M one. Values above `100%` are accepted, but the color then
  never reaches full red.
- Anything else falls back to `200k`: zero, negative numbers, thousands
  separators (`200,000`), scientific notation (`2e5`), a leading dot (`.5M`)
  or extra words (`200k tokens`).

Set it in `/config`, with `/plugin configure context-statusline@petritol`, or
in `~/.claude/settings.json` as a quoted string:

```json
{
  "pluginConfigs": {
    "context-statusline@petritol": {
      "options": { "contextBudget": "80%", "showUsageLimits": false }
    }
  }
}
```

### Usage limits

`showUsageLimits` shows or hides the session (5-hour) and weekly limits. It is
a boolean and defaults to `true`; `false` hides both limits.

## Development

```sh
claude plugin validate .
claude plugin test .
```

## License

[The Unlicense](LICENSE) — public domain. Do whatever you want with it.
