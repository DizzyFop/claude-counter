# AI Counter

A minimal browser extension that shows approximate token counts and native usage signals on Claude and ChatGPT.

![AI Counter screenshot](./screenshot.png)

## Features

- **Claude token count** — Approximate token count for the current conversation, with a mini progress bar against the 200k context limit
- **Claude cache timer** — Countdown showing how long the conversation remains cached (cheaper to continue)
- **Claude usage bars** — Session (5-hour) and weekly (7-day) usage from Claude's native API, with progress bars and reset countdowns
- **ChatGPT token count** — Approximate token count for the active conversation branch, using structured conversation data when available and visible messages as a fallback
- **ChatGPT context status** — Context progress appears only when ChatGPT exposes an exact context window for the current model
- **ChatGPT usage bars** — Session/weekly bars appear only when ChatGPT exposes exact native usage and reset signals

## Installation

**Chrome / Edge / Chromium**

1. Download [`ai-counter-0.5.0.zip`](../../releases/download/v0.5.0/ai-counter-0.5.0.zip)
2. Go to `chrome://extensions` and enable **Developer mode**
3. Drag and drop the zip onto the page

**Firefox**

1. Download [`ai-counter-0.5.0.xpi`](../../releases/download/v0.5.0/ai-counter-0.5.0.xpi)
2. Drag it into any Firefox window and click **Add**

**Userscript**

1. The userscript remains Claude-only: [`claude-counter.user.js`](./userscript/claude-counter.user.js)

## How it works

- Intercepts Claude and ChatGPT page responses locally to read conversation data and exact native usage signals when available
- Uses a vendored tokenizer (`o200k_base`) for approximate token counting
- Uses Claude’s `/usage` plus live SSE `message_limit` data; the SSE provides exact, unrounded utilization fractions
- Uses ChatGPT structured conversation payloads when available, and falls back to visible message text without estimating usage limits
- Watches for DOM changes to inject UI elements as you navigate

## Privacy

- All data stays local — no external servers, no tracking
- Reads your `lastActiveOrg` cookie to query Claude's `/usage` endpoint
- Makes requests only to the current supported site (`claude.ai`, `chatgpt.com`, or `chat.openai.com`)

## Credits

- Token counting via [gpt-tokenizer](https://github.com/niieani/gpt-tokenizer) (MIT)
- Inspired by [Claude Usage Tracker](https://github.com/lugia19/Claude-Usage-Extension) by lugia19

## License

MIT
