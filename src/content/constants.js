(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	CC.DOM = Object.freeze({
		CHAT_TITLE_SPLIT: '[data-testid="chat-title-split"]',
		COMPOSER: '[data-cds="ChatComposer"]',
		COMPOSER_ACTIONS: '[data-cds="ChatComposerActions"]',
		COMPOSER_CHIN: '[data-cds="ChatComposerChin"]',
		BRIDGE_SCRIPT_ID: 'cc-bridge-script'
	});

	CC.CONST = Object.freeze({
		// claude.ai doesn't publish its cache lifetime (the API default is 5 minutes). Usage
		// testing on claude.ai found 1 hour, refreshed by each reply:
		// github.com/lugia19/Claude-Usage-Extension/issues/62 (May 2026, re-tested July 2026).
		CACHE_WINDOW_MS: 60 * 60 * 1000,
		CONTEXT_LIMIT_TOKENS: 200000
	});

	CC.COLORS = Object.freeze({
		PROGRESS_FILL_DARK: '#2c84db',
		PROGRESS_FILL_LIGHT: '#5aa6ff',
		PROGRESS_OUTLINE_DARK: '#787877',
		PROGRESS_OUTLINE_LIGHT: '#bfbfbf',
		PROGRESS_MARKER_DARK: '#ffffff',
		PROGRESS_MARKER_LIGHT: '#111111',
		FABLE_FILL_DARK: '#1d9e75',
		FABLE_FILL_LIGHT: '#2bb98a',
		FABLE_WARN_DARK: '#e0a020',
		FABLE_WARN_LIGHT: '#c9860a',
		RED_WARNING: '#ce2029',
		BOLD_LIGHT: '#141413',
		BOLD_DARK: '#faf9f5'
	});
})();
