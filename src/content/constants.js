(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	CC.DOM = Object.freeze({
		// claude.ai renamed chats to sessions in Sept 2026; keep the old id while that rolls out.
		CHAT_TITLE_SPLIT: '[data-testid="session-title-split"], [data-testid="chat-title-split"]',
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

	// Settings the toolbar popup changes, with their defaults. The popup loads this file too.
	CC.SETTINGS_DEFAULTS = Object.freeze({
		usageStyle: 'lines', // 'lines' (hairlines on the message box) or 'bars' (the original row)
		alwaysShowLabels: false
	});

	CC.COLORS = Object.freeze({
		PROGRESS_FILL_DARK: '#2c84db',
		PROGRESS_FILL_LIGHT: '#5aa6ff',
		PROGRESS_OUTLINE_DARK: '#787877',
		PROGRESS_OUTLINE_LIGHT: '#bfbfbf',
		PROGRESS_MARKER_DARK: '#ffffff',
		PROGRESS_MARKER_LIGHT: '#111111',
		EDGE_TRACK_DARK: 'rgba(255, 255, 255, 0.08)',
		EDGE_TRACK_LIGHT: 'rgba(0, 0, 0, 0.08)',
		FABLE_FILL_DARK: '#1d9e75',
		FABLE_FILL_LIGHT: '#2bb98a',
		FABLE_WARN_DARK: '#e0a020',
		FABLE_WARN_LIGHT: '#c9860a',
		RED_WARNING: '#ce2029',
		BOLD_LIGHT: '#141413',
		BOLD_DARK: '#faf9f5'
	});
})();
