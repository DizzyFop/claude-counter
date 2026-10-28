# Chrome Web Store listing

Text to paste into the developer dashboard. The listing title and the short summary come from `manifest.json` (`name` and `description`), so they aren't here.

## Package

Upload the same zip as Firefox:

```
git archive --format=zip -o claude-counter-<version>.zip HEAD manifest.json icons src
```

## Store listing tab

**Description**

```
Sightglass for Claude adds a token count, a cache timer and your usage limits to claude.ai.

Token count. An approximate token count for the open conversation, with a small bar against the model's context window.

Cache timer. A countdown of roughly how long the conversation stays cached. Replying while it's cached uses less of your limit.

Usage lines. Your session (5-hour) usage runs along the top edge of the message box and your weekly (7-day) usage along the bottom, read from Claude's own usage data. Hover the box to see the numbers and reset times. On plans that include Fable, a second line shows the Fable limit.

Click the toolbar button to keep the usage text showing, or to switch back to the original bars inside the message box.

It runs in your claude.ai tab and only talks to claude.ai, using the session you're signed in with.

Sightglass for Claude is open source under the MIT license and isn't affiliated with Anthropic. Based on claude-counter by she-llac.
https://github.com/DizzyFop/claude-counter
```

**Category:** Productivity > Tools

**Language:** English (United States)

**Store icon:** `icons/icon128.png`

**Screenshots:** `store/screenshot-1280x800.png`. Each one must be exactly 1280x800 or 640x400.

**Small promo tile (optional):** `store/promo-small-440x280.png`. Listings without one are shown after listings with one.

**Homepage URL:** https://github.com/DizzyFop/claude-counter

## Privacy practices tab

**Single purpose description**

```
Shows an approximate token count, a cache timer and usage limits for the open conversation on claude.ai.
```

**Permission justification: storage**

```
Saves the two display settings from the toolbar popup.
```

**Permission justification: host permission (https://claude.ai/*)**

```
The content script runs only on claude.ai. It reads the open conversation and the usage data claude.ai already loads, and draws the counter on the page.
```

**Remote code:** No, I am not using remote code. All scripts, including the tokenizer and `src/injected/bridge.js`, ship in the package.

**Data usage:** check Website content and Personal communications. The extension reads the conversation text on claude.ai to count tokens. It never leaves the browser, but Google counts data handled on the device too. Then tick all three certifications (not sold, not used for unrelated purposes, not used for credit decisions).

**Privacy policy URL:** https://github.com/DizzyFop/claude-counter/blob/main/PRIVACY.md

## Distribution tab

Free, Public, all regions.
