(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	const ROOT_MESSAGE_ID = '00000000-0000-4000-8000-000000000000';

	function stableStringify(value) {
		const seen = new WeakSet();

		const normalize = (v) => {
			if (v === null || typeof v !== 'object') return v;
			if (seen.has(v)) return '[Circular]';
			seen.add(v);

			if (Array.isArray(v)) return v.map(normalize);

			const out = {};
			for (const key of Object.keys(v).sort()) {
				out[key] = normalize(v[key]);
			}
			return out;
		};

		try {
			return JSON.stringify(normalize(value));
		} catch {
			return '';
		}
	}

	function getTokenizer() {
		return globalThis.GPTTokenizer_o200k_base || null;
	}

	function countTokens(text) {
		if (!text) return 0;
		const tokenizer = getTokenizer();
		if (!tokenizer?.countTokens) return 0;
		try {
			return tokenizer.countTokens(text);
		} catch {
			return 0;
		}
	}

	function buildTrunk(conversation) {
		const messages = Array.isArray(conversation?.chat_messages) ? conversation.chat_messages : [];
		const byId = new Map();
		for (const msg of messages) {
			if (msg?.uuid) byId.set(msg.uuid, msg);
		}

		const leaf = conversation?.current_leaf_message_uuid;
		if (!leaf) return [];

		const trunk = [];
		let currentId = leaf;
		while (currentId && currentId !== ROOT_MESSAGE_ID) {
			const msg = byId.get(currentId);
			if (!msg) break;
			trunk.push(msg);
			currentId = msg.parent_message_uuid;
		}

		trunk.reverse();
		return trunk;
	}

	function buildChatGptTrunk(conversation) {
		const mapping = conversation?.mapping && typeof conversation.mapping === 'object' ? conversation.mapping : null;
		if (!mapping) return [];

		const rootId =
			conversation.current_node ||
			conversation.currentNode ||
			conversation.current_node_id ||
			conversation.moderation_results?.current_node ||
			null;
		let currentId = rootId;

		if (!currentId) {
			const leaves = Object.values(mapping).filter((node) => Array.isArray(node?.children) && node.children.length === 0);
			currentId = leaves[leaves.length - 1]?.id || null;
		}

		const trunk = [];
		const seen = new Set();
		while (currentId && !seen.has(currentId)) {
			seen.add(currentId);
			const node = mapping[currentId];
			if (!node) break;
			if (node.message) trunk.push(node.message);
			currentId = node.parent || node.parent_id || null;
		}

		trunk.reverse();
		return trunk;
	}

	function isCountableContentItem(item) {
		if (!item || typeof item !== 'object') return false;
		if (typeof item.type !== 'string') return false;
		if (item.type === 'thinking' || item.type === 'redacted_thinking') return false;
		if (item.type === 'image' || item.type === 'document') return false;
		return true;
	}

	function stringifyCountableContentItem(item) {
		if (!isCountableContentItem(item)) return '';

		// Common fast-path for text blocks.
		if (item.type === 'text' && typeof item.text === 'string') return item.text;

		// Tool blocks: include observable payloads deterministically, but exclude "thinking".
		if (item.type === 'tool_use') {
			const minimal = {
				id: item.id,
				name: item.name,
				input: item.input
			};
			return stableStringify(minimal);
		}

		if (item.type === 'tool_result') {
			const minimal = {
				tool_use_id: item.tool_use_id,
				is_error: item.is_error,
				content: item.content
			};
			return stableStringify(minimal);
		}

		// Fallback: keep only known-ish textual fields to avoid pulling in huge binary-ish blobs.
		const minimal = {};
		if (typeof item.text === 'string') minimal.text = item.text;
		if (typeof item.title === 'string') minimal.title = item.title;
		if (typeof item.url === 'string') minimal.url = item.url;
		if (typeof item.content === 'string') minimal.content = item.content;
		if (Array.isArray(item.content)) minimal.content = item.content;
		if (Object.keys(minimal).length === 0) return '';
		return stableStringify(minimal);
	}

	function stringifyMessageCountables(message) {
		const parts = [];

		// Message content blocks (primary source for tools, text, etc).
		const content = Array.isArray(message?.content) ? message.content : [];
		for (const item of content) {
			const s = stringifyCountableContentItem(item);
			if (s) parts.push(s);
		}

		// Attachment extracted content (observable, already text).
		const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
		for (const a of attachments) {
			if (typeof a?.extracted_content === 'string' && a.extracted_content) {
				parts.push(a.extracted_content);
			}
		}

		return parts.join('\n');
	}

	function stringifyChatGptPart(part) {
		if (!part) return '';
		if (typeof part === 'string') return part;
		if (typeof part !== 'object') return '';
		if (typeof part.text === 'string') return part.text;
		if (typeof part.content === 'string') return part.content;
		if (typeof part.name === 'string' && typeof part.url === 'string') {
			return stableStringify({ name: part.name, url: part.url });
		}
		if (part.type === 'image' || part.content_type === 'image') return '';
		return '';
	}

	function stringifyChatGptMessageCountables(message) {
		const role = message?.author?.role || message?.role || '';
		if (role === 'system' || role === 'developer') return '';
		if (message?.metadata?.is_visually_hidden_from_conversation) return '';

		const content = message?.content;
		const parts = [];
		if (Array.isArray(content?.parts)) {
			for (const part of content.parts) {
				const s = stringifyChatGptPart(part);
				if (s) parts.push(s);
			}
		} else if (typeof content?.text === 'string') {
			parts.push(content.text);
		} else if (typeof content === 'string') {
			parts.push(content);
		}

		if (content?.content_type === 'code' && typeof content?.text === 'string') {
			parts.push(content.text);
		}

		return parts.join('\n');
	}

	function normalizeContextLimitCandidate(value) {
		if (typeof value !== 'number' || !Number.isFinite(value)) return null;
		if (value < 4000 || value > 2000000) return null;
		return Math.round(value);
	}

	function findExplicitContextLimit(value, path = '', depth = 0) {
		if (!value || typeof value !== 'object' || depth > 8) return null;

		for (const [key, child] of Object.entries(value)) {
			const keyPath = path ? `${path}.${key}` : key;
			const normalizedKey = key.toLowerCase();
			const normalizedPath = keyPath.toLowerCase();
			const looksContextual =
				(normalizedPath.includes('context') || normalizedPath.includes('window')) &&
				(normalizedKey.includes('token') || normalizedKey.includes('limit') || normalizedKey.includes('size'));
			if (looksContextual) {
				const candidate = normalizeContextLimitCandidate(child);
				if (candidate) return candidate;
			}
		}

		for (const [key, child] of Object.entries(value)) {
			if (!child || typeof child !== 'object') continue;
			const found = findExplicitContextLimit(child, path ? `${path}.${key}` : key, depth + 1);
			if (found) return found;
		}

		return null;
	}

	function getChatGptContextLimit(conversation) {
		const explicit = findExplicitContextLimit(conversation);
		if (!explicit) return null;
		return {
			contextLimitTokens: explicit,
			contextLabel: `${Math.round(explicit / 1000).toLocaleString()}k context`
		};
	}

	async function hashString(str) {
		if (!CC.bridge?.requestHash) return null;
		try {
			const res = await CC.bridge.requestHash(str);
			if (res?.hash) return res.hash;
		} catch {
			// No local hashing fallback.
		}
		return null;
	}

	async function fingerprint(text) {
		if (!text) return null;
		const hash = await hashString(text);
		if (!hash) return null;
		return `${text.length}:${hash}`;
	}

	class TokenCache {
		constructor() {
			this._byMessageId = new Map(); // uuid -> { fp, tokens }
		}

		async getMessageTokens(messageId, messageText) {
			const fp = await fingerprint(messageText);
			if (!fp) return countTokens(messageText);
			const cached = this._byMessageId.get(messageId);
			if (cached && cached.fp === fp) return cached.tokens;

			const tokens = countTokens(messageText);
			this._byMessageId.set(messageId, { fp, tokens });
			return tokens;
		}

		pruneToMessageIds(keepIds) {
			const keep = new Set(keepIds);
			for (const id of this._byMessageId.keys()) {
				if (!keep.has(id)) this._byMessageId.delete(id);
			}
		}
	}

	const tokenCache = new TokenCache();

	async function computeClaudeConversationMetrics(conversation) {
		const trunk = buildTrunk(conversation);
		const trunkIds = trunk.map((m) => m.uuid).filter(Boolean);
		tokenCache.pruneToMessageIds(trunkIds);

		let totalTokens = 0;
		let lastAssistantMs = null;

		for (const msg of trunk) {
			if (msg?.sender === 'assistant' && msg?.created_at) {
				const msgMs = Date.parse(msg.created_at);
				if (!lastAssistantMs || msgMs > lastAssistantMs) {
					lastAssistantMs = msgMs;
				}
			}

			const msgText = stringifyMessageCountables(msg);
			const msgTokens = msg?.uuid ? await tokenCache.getMessageTokens(msg.uuid, msgText) : countTokens(msgText);
			totalTokens += msgTokens;
		}
		const cachedUntil = lastAssistantMs ? lastAssistantMs + CC.CONST.CACHE_WINDOW_MS : null;

		return {
			trunkMessageCount: trunk.length,
			totalTokens,
			lastAssistantMs,
			cachedUntil
		};
	}

	async function computeChatGptConversationMetrics(conversation) {
		const trunk = buildChatGptTrunk(conversation);
		const trunkIds = trunk.map((m, index) => m.id || m.message_id || `chatgpt:${index}`).filter(Boolean);
		tokenCache.pruneToMessageIds(trunkIds);

		let totalTokens = 0;
		for (let index = 0; index < trunk.length; index += 1) {
			const msg = trunk[index];
			const msgText = stringifyChatGptMessageCountables(msg);
			if (!msgText) continue;
			const msgId = msg.id || msg.message_id || `chatgpt:${index}`;
			totalTokens += await tokenCache.getMessageTokens(msgId, msgText);
		}

		return {
			trunkMessageCount: trunk.length,
			totalTokens,
			source: 'structured',
			...getChatGptContextLimit(conversation)
		};
	}

	async function computeVisibleChatGptMetrics() {
		let nodes = Array.from(document.querySelectorAll('[data-message-author-role]'));
		if (!nodes.length) nodes = Array.from(document.querySelectorAll('[data-testid^="conversation-turn-"]'));
		if (!nodes.length) nodes = Array.from(document.querySelectorAll('main article'));
		const visibleNodes = nodes.filter((node) => {
			const text = node.innerText?.trim();
			if (!text) return false;
			const role = node.getAttribute('data-message-author-role');
			return role !== 'system' && role !== 'developer';
		});

		let totalTokens = 0;
		for (let index = 0; index < visibleNodes.length; index += 1) {
			const text = visibleNodes[index].innerText.trim();
			totalTokens += await tokenCache.getMessageTokens(`chatgpt-visible:${index}`, text);
		}

		return {
			trunkMessageCount: visibleNodes.length,
			totalTokens,
			source: 'visible'
		};
	}

	async function computeConversationMetrics(conversation, { siteId } = {}) {
		if (siteId === 'chatgpt') return computeChatGptConversationMetrics(conversation);
		return computeClaudeConversationMetrics(conversation);
	}

	CC.tokens = { computeConversationMetrics, computeVisibleChatGptMetrics };
})();
