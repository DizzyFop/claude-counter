# Claude Counter

A minimal browser extension that shows token count, cache timer, and usage bars on claude.ai.

![Claude Counter screenshot](./screenshot.png)

## Features

- **Token count.** Approximate token count for the current conversation, with a mini progress bar against the model's context window (1M, 500K or 200K tokens)
- **Cache timer.** Countdown showing roughly how long the conversation stays cached, so your next message uses less of your limit. claude.ai doesn't publish the cache length; [community testing](https://github.com/lugia19/Claude-Usage-Extension/issues/62) found about an hour.
- **Usage bars.** Session (5-hour) and weekly (7-day) usage from Claude's own API, with progress bars and reset countdowns. On plans that include Fable, the weekly bar also shows the Fable limit.

## Installation

**Firefox**

Install [Claude Counter from Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/claude-counter-dizzy/).

**Chrome / Edge / Chromium**

1. Download or clone this repository
2. Go to `chrome://extensions` and turn on **Developer mode**
3. Click **Load unpacked** and select the repository folder

## How it works

- Intercepts Claude's API responses to read conversation data and usage info
- Counts text with a vendored tokenizer (`o200k_base`), scaled by 1.5 for Claude 4.7 and later models, whose tokenizer uses more tokens for the same text
- Reads usage from Claude's `/usage` endpoint and updates it live from the `message_limit` event Claude sends with each reply
- Watches for DOM changes to inject UI elements as you navigate

## Privacy

- All data stays local. No external servers, no tracking
- Reads your `lastActiveOrg` cookie to query Claude's `/usage` endpoint
- Makes requests only to `claude.ai`

## Credits

- Token counting via [gpt-tokenizer](https://github.com/niieani/gpt-tokenizer) (MIT)
- Inspired by [Claude Usage Tracker](https://github.com/lugia19/Claude-Usage-Extension) by lugia19

## License

MIT
