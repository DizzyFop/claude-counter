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
			// allowedSpecial: 'all' stops the tokenizer throwing on literal special-token
			// strings like <|endoftext|>, which previously zeroed the entire message.
			return tokenizer.countTokens(text, { allowedSpecial: 'all' });
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

	function isCountableContentItem(item) {
		if (!item || typeof item !== 'object') return false;
		if (typeof item.type !== 'string') return false;
		if (item.type === 'thinking' || item.type === 'redacted_thinking') return false;
		if (item.type === 'image' || item.type === 'document') return false;
		return true;
	}

	// Tool results can embed image blocks whose base64 payload is megabytes long, which
	// tokenizes into a wildly inflated count. Drop the payload the same way top-level
	// image/document blocks are skipped, keeping the surrounding shape intact.
	function stripBinaryPayloads(value, depth = 0) {
		if (value === null || typeof value !== 'object' || depth > 8) return value;
		if (Array.isArray(value)) return value.map((v) => stripBinaryPayloads(v, depth + 1));
		if (value.type === 'image' || value.type === 'document') return { type: value.type };
		const out = {};
		for (const key of Object.keys(value)) {
			out[key] = stripBinaryPayloads(value[key], depth + 1);
		}
		return out;
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
				content: stripBinaryPayloads(item.content)
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

	// --- Models ---
	// Parses ids like "claude-opus-5-5" or "claude-haiku-4-5-20251001" into
	// { family: 'opus', version: 5.5 }. The minor part is 1-2 digits so a date suffix is skipped.
	function parseModel(model) {
		const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|$)/.exec(typeof model === 'string' ? model : '');
		return m ? { family: m[1], version: Number(m[2]) + Number(m[3] || 0) / 10 } : null;
	}

	// Chat context window on paid plans (support.claude.com/en/articles/8606394, Sept 2026):
	// 1M for Fable 5.1, Opus 5+ and Sonnet 5+; 500K for Fable 5 and Opus 4.6-4.8; 200K otherwise.
	function contextWindowFor(model) {
		const p = parseModel(model);
		if (!p) return CC.CONST.CONTEXT_LIMIT_TOKENS;
		if ((p.family === 'opus' || p.family === 'sonnet') && p.version >= 5) return 1000000;
		if (p.family === 'fable') return p.version >= 5.1 ? 1000000 : 500000;
		if (p.family === 'opus' && p.version >= 4.6) return 500000;
		return CC.CONST.CONTEXT_LIMIT_TOKENS;
	}

	// Claude 4.7 and later use a newer tokenizer. Anthropic's figures (1M tokens ~ 555k words,
	// vs ~750k on older models) put it at ~1.35x the old Claude tokenizer, which itself runs ~5%
	// above o200k. Measured English prose lands at 1.45-1.6x o200k, code lower. 1.5 splits it.
	const NEW_TOKENIZER_SCALE = 1.5;

	function textTokenScaleFor(model) {
		const p = parseModel(model);
		return p && p.version >= 4.7 ? NEW_TOKENIZER_SCALE : 1;
	}

	// --- Non-text uploads (images, PDFs) ---
	// claude.ai attaches uploads to a message via files (files_v2 on older payloads), not in
	// the text content, so the tokenizer never sees them.
	//   - images: one token per 28x28 px patch. claude.ai's preview asset is already
	//             downscaled to the standard limit (1568 px long edge, 1568 tokens).
	//   - PDFs:   claude.ai reports a token_count per document; fall back to a per-page estimate.
	// These are approximations and will differ from Claude's exact count.
	const IMG_PATCH_PX = 28;
	const IMG_TOKENS_CAP = 1568;
	const DOC_TOKENS_PER_PAGE = 1600;

	function estimateImageTokens(file) {
		const w = file?.preview_asset?.image_width;
		const h = file?.preview_asset?.image_height;
		if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) {
			return Math.min(IMG_TOKENS_CAP, Math.ceil(w / IMG_PATCH_PX) * Math.ceil(h / IMG_PATCH_PX));
		}
		return IMG_TOKENS_CAP; // dimensions unknown: assume a full-size image
	}

	function estimateFileTokens(message) {
		const v2 = Array.isArray(message?.files_v2) ? message.files_v2 : null;
		const files = v2 && v2.length ? v2 : (Array.isArray(message?.files) ? message.files : []);
		let tokens = 0;
		for (const file of files) {
			const docTokens = file?.document_asset?.token_count;
			const pageCount = file?.document_asset?.page_count;
			if (typeof docTokens === 'number' && docTokens > 0) {
				tokens += docTokens;
			} else if (typeof pageCount === 'number' && pageCount > 0) {
				tokens += pageCount * DOC_TOKENS_PER_PAGE;
			} else if (file?.preview_asset) {
				tokens += estimateImageTokens(file);
			}
		}
		return tokens;
	}

	// The prompt cache is refreshed when a request is processed, not when the reply finishes
	// (claude.ai sets created_at on an assistant message at the end). A reply with tool calls
	// spans several requests, and the last one starts right after the final tool_result, so use
	// the start of the first block after it. Falls back to created_at.
	function lastRequestMs(message) {
		const blocks = Array.isArray(message?.content) ? message.content : [];
		let anchorMs = null;
		let nextStartsRequest = true;
		for (const block of blocks) {
			if (nextStartsRequest) {
				const startMs = Date.parse(block?.start_timestamp);
				if (Number.isFinite(startMs)) anchorMs = startMs;
				nextStartsRequest = false;
			}
			if (block?.type === 'tool_result') nextStartsRequest = true;
		}
		return anchorMs ?? Date.parse(message?.created_at);
	}

	async function computeConversationMetrics(conversation) {
		const trunk = buildTrunk(conversation);
		const trunkIds = trunk.map((m) => m.uuid).filter(Boolean);
		tokenCache.pruneToMessageIds(trunkIds);

		let textTokens = 0;
		let fileTokens = 0;
		let lastAssistantMs = null;

		for (const msg of trunk) {
			if (msg?.sender === 'assistant') {
				const msgMs = lastRequestMs(msg);
				if (Number.isFinite(msgMs) && (!lastAssistantMs || msgMs > lastAssistantMs)) {
					lastAssistantMs = msgMs;
				}
			}

			const msgText = stringifyMessageCountables(msg);
			textTokens += msg?.uuid ? await tokenCache.getMessageTokens(msg.uuid, msgText) : countTokens(msgText);
			fileTokens += estimateFileTokens(msg);
		}
		// Images and PDFs are already estimated in Claude tokens; only the o200k text count is scaled.
		const totalTokens = Math.round(textTokens * textTokenScaleFor(conversation?.model)) + fileTokens;
		const cachedUntil = lastAssistantMs ? lastAssistantMs + CC.CONST.CACHE_WINDOW_MS : null;

		return {
			trunkMessageCount: trunk.length,
			totalTokens,
			contextLimit: contextWindowFor(conversation?.model),
			lastAssistantMs,
			cachedUntil
		};
	}

	CC.tokens = { computeConversationMetrics };
})();
