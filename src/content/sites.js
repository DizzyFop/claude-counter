(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	function firstElement(selectors) {
		for (const selector of selectors) {
			let el = null;
			try {
				el = document.querySelector(selector);
			} catch {
				el = null;
			}
			if (el) return el;
		}
		return null;
	}

	function findAncestorWithButtons(el, stopAt) {
		let cur = el;
		while (cur && cur !== document.body) {
			if (stopAt && cur === stopAt) break;
			if (cur !== el && cur.nodeType === 1) {
				const style = window.getComputedStyle(cur);
				if (style.display === 'flex' && style.flexDirection === 'row' && cur.querySelectorAll('button').length > 1) {
					return cur;
				}
			}
			cur = cur.parentElement;
		}
		return null;
	}

	function getClaudeOrgIdFromCookie() {
		try {
			return document.cookie
				.split('; ')
				.find((row) => row.startsWith('lastActiveOrg='))
				?.split('=')[1] || null;
		} catch {
			return null;
		}
	}

	function getClaudeConversationId() {
		const match = window.location.pathname.match(/\/chat\/([^/?]+)/);
		return match ? match[1] : null;
	}

	function getChatGptConversationId() {
		const match = window.location.pathname.match(/\/c\/([^/?]+)/);
		return match ? match[1] : null;
	}

	const claude = Object.freeze({
		id: 'claude',
		name: 'Claude',
		hosts: new Set(['claude.ai']),
		hasCacheTimer: true,
		contextLimitTokens: CC.CONST.CONTEXT_LIMIT_TOKENS,
		tokenTooltip:
			"Approximate tokens (excludes system prompt).\nUses a generic tokenizer, may differ from Claude's count.\nBecomes invalid after context compaction.\nBar scale: 200k tokens (Claude's maximum context length, will compact before then).",
		contextTooltip:
			"Approximate tokens (excludes system prompt).\nUses a generic tokenizer, may differ from Claude's count.\nThis count is invalid after compaction.",
		cacheTooltip: 'Messages sent while cached are significantly cheaper.',
		sessionTooltip: '5-hour session window.\nThe bar shows your usage.\nThe line marks where you are in the window.',
		weeklyTooltip: '7-day usage window.\nThe bar shows your usage.\nThe line marks where you are in the window.',
		getConversationId: getClaudeConversationId,
		getOrgId: getClaudeOrgIdFromCookie,
		findHeaderAnchor() {
			const chatMenu = document.querySelector(CC.DOM.CLAUDE_CHAT_MENU_TRIGGER);
			return chatMenu?.closest(CC.DOM.CLAUDE_CHAT_PROJECT_WRAPPER) || chatMenu?.parentElement || null;
		},
		findUsageAnchor() {
			const modelSelector = document.querySelector(CC.DOM.CLAUDE_MODEL_SELECTOR_DROPDOWN);
			if (!modelSelector) return null;
			const gridContainer = modelSelector.closest('[data-testid="chat-input-grid-container"]');
			const gridArea = modelSelector.closest('[data-testid="chat-input-grid-area"]');
			return (
				(gridContainer ? findAncestorWithButtons(modelSelector, gridArea || gridContainer) : null) ||
				findAncestorWithButtons(modelSelector) ||
				modelSelector.parentElement?.parentElement?.parentElement ||
				null
			);
		}
	});

	const chatgpt = Object.freeze({
		id: 'chatgpt',
		name: 'ChatGPT',
		hosts: new Set(['chatgpt.com', 'chat.openai.com']),
		hasCacheTimer: false,
		tokenTooltip:
			'Approximate tokens from ChatGPT conversation data when available, otherwise visible message text.\nContext bar appears only when ChatGPT exposes an exact context window.',
		contextTooltip:
			'Context status is shown only when ChatGPT exposes an exact context window for the current model.',
		cacheTooltip: 'ChatGPT does not expose a Claude-style prompt-cache timer here.',
		sessionTooltip:
			'Native ChatGPT usage is shown only when exact limits are exposed by ChatGPT.',
		weeklyTooltip:
			'Native ChatGPT weekly usage is shown only when exact limits are exposed by ChatGPT.',
		getConversationId: getChatGptConversationId,
		getOrgId: () => null,
		findHeaderAnchor() {
			const header = firstElement([
				'[data-testid="conversation-title"]',
				'[data-testid="chat-title"]',
				'main h1',
				'main header',
				'[role="main"] header'
			]);
			if (header) return header;

			const main = document.querySelector('main');
			const firstTurn = document.querySelector('[data-message-author-role], [data-testid^="conversation-turn-"], article');
			return firstTurn?.parentElement || main?.firstElementChild || null;
		},
		findUsageAnchor() {
			const composer = firstElement([
				'[data-testid="composer-footer-actions"]',
				'form[data-type="unified-composer"]',
				'form:has(#prompt-textarea)',
				'#composer-background',
				'#prompt-textarea'
			]);
			if (!composer) return null;
			return (
				composer.closest('[data-testid="composer-footer-actions"]') ||
				composer.closest('form') ||
				findAncestorWithButtons(composer) ||
				composer.parentElement ||
				composer
			);
		}
	});

	const sites = Object.freeze({ claude, chatgpt });

	function currentSite() {
		const host = window.location.hostname;
		return Object.values(sites).find((site) => site.hosts.has(host)) || null;
	}

	CC.sites = { all: sites, current: currentSite };
})();
