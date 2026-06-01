(() => {
	'use strict';

	const CC_MARKER = 'ClaudeCounter';
	const SITE = getSite();

	const originalFetch = window.fetch;
	const originalPushState = history.pushState.bind(history);
	const originalReplaceState = history.replaceState.bind(history);

	history.pushState = function (...args) {
		const result = originalPushState(...args);
		window.dispatchEvent(new CustomEvent('cc:urlchange'));
		return result;
	};

	history.replaceState = function (...args) {
		const result = originalReplaceState(...args);
		window.dispatchEvent(new CustomEvent('cc:urlchange'));
		return result;
	};

	if (originalFetch) {
		window.fetch = async (...args) => {
			const url = toAbsoluteUrl(args[0]);
			const method = getRequestMethod(args[0], args[1]);

			if (isGenerationRequest(SITE, url, method)) {
				post('cc:generation_start', { site: SITE });
			}

			const response = await originalFetch.apply(window, args);
			inspectResponse(SITE, url, method, response);
			return response;
		};
	}

	function getSite() {
		const host = window.location.hostname;
		if (host === 'claude.ai') return 'claude';
		if (host === 'chatgpt.com' || host === 'chat.openai.com') return 'chatgpt';
		return 'unknown';
	}

	function post(type, payload) {
		window.postMessage({ cc: CC_MARKER, type, payload }, '*');
	}

	function postResponse(requestId, ok, payload, error) {
		window.postMessage(
			{
				cc: CC_MARKER,
				type: 'cc:response',
				requestId,
				ok,
				payload,
				error
			},
			'*'
		);
	}

	function toAbsoluteUrl(input) {
		try {
			if (typeof input === 'string') return new URL(input, window.location.origin).href;
			if (input instanceof URL) return input.href;
			if (input instanceof Request) return input.url;
		} catch {
			return '';
		}
		return '';
	}

	function getRequestMethod(input, opts) {
		const method = opts?.method || (input instanceof Request ? input.method : '') || 'GET';
		return String(method).toUpperCase();
	}

	function isGenerationRequest(site, url, method) {
		if (!url || method !== 'POST') return false;
		if (site === 'claude') return url.includes('/completion') || url.includes('/retry_completion');
		if (site === 'chatgpt') return /\/backend-api\/(?:f\/)?conversation(?:\/|$)/.test(url);
		return false;
	}

	function inspectResponse(site, url, method, response) {
		try {
			const contentType = response.headers.get('content-type') || '';
			if (contentType.includes('event-stream')) {
				handleEventStream(site, response);
			}

			if (site === 'claude' && url.includes('/chat_conversations/') && url.includes('tree=')) {
				const meta = getClaudeConversationMeta(url);
				if (meta) handleClaudeConversationResponse(meta, response);
				return;
			}

			if (site === 'chatgpt' && isChatGptBackendUrl(url)) {
				const meta = getChatGptConversationMeta(url);
				if (meta && method === 'GET') {
					handleChatGptConversationResponse(meta, response);
					return;
				}
				if (contentType.includes('json')) {
					handleChatGptUsageSignalResponse(response);
				}
			}
		} catch {
			// best-effort; never break the host page
		}
	}

	function getClaudeConversationMeta(url) {
		const match = url.match(/^https:\/\/claude\.ai\/api\/organizations\/([^/]+)\/chat_conversations\/([^/?]+)/);
		return match ? { orgId: match[1], conversationId: match[2] } : null;
	}

	function isChatGptBackendUrl(url) {
		return /https:\/\/(?:chatgpt\.com|chat\.openai\.com)\/(?:backend-api|public-api|api)\//.test(url);
	}

	function getChatGptConversationMeta(url) {
		const match = url.match(/\/backend-api\/(?:f\/)?conversation\/([^/?]+)/);
		return match ? { conversationId: match[1] } : null;
	}

	async function handleClaudeConversationResponse({ orgId, conversationId }, response) {
		try {
			const data = await response.clone().json();
			post('cc:conversation', { site: 'claude', orgId, conversationId, data });
		} catch {
			// ignore parse failures
		}
	}

	async function handleChatGptConversationResponse({ conversationId }, response) {
		try {
			const data = await response.clone().json();
			post('cc:conversation', { site: 'chatgpt', conversationId, data });
			if (containsLimitSignal(data)) {
				post('cc:chatgpt_usage_signal', data);
			}
		} catch {
			// ignore parse failures
		}
	}

	async function handleChatGptUsageSignalResponse(response) {
		try {
			const data = await response.clone().json();
			if (containsLimitSignal(data)) {
				post('cc:chatgpt_usage_signal', data);
			}
		} catch {
			// ignore parse failures
		}
	}

	async function fetchJson(url, options = {}) {
		const headers = {
			accept: 'application/json',
			...(options.body ? { 'content-type': 'application/json' } : {}),
			...(options.headers || {})
		};
		const res = await originalFetch(url, {
			credentials: 'include',
			...options,
			headers
		});
		if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
		return res.json();
	}

	async function requestChatGptUsageSnapshots() {
		const snapshots = [];
		const origin = window.location.origin;
		const addSnapshot = (source, payload) => {
			if (payload && typeof payload === 'object') {
				snapshots.push({ source, payload });
				if (containsLimitSignal(payload)) post('cc:chatgpt_usage_signal', payload);
			}
		};

		const candidates = [
			{
				source: 'conversation_init_json',
				run: () => fetchJson(`${origin}/backend-api/conversation/init`, {
					method: 'POST',
					body: JSON.stringify({})
				})
			},
			{
				source: 'conversation_init_timezone',
				run: () => fetchJson(`${origin}/backend-api/conversation/init`, {
					method: 'POST',
					body: JSON.stringify({ timezone_offset_min: new Date().getTimezoneOffset() })
				})
			},
			{
				source: 'conversation_init_empty',
				run: () => fetchJson(`${origin}/backend-api/conversation/init`, { method: 'POST' })
			},
			{
				source: 'models',
				run: () => fetchJson(`${origin}/backend-api/models`, { method: 'GET' })
			},
			{
				source: 'account_check',
				run: () => fetchJson(`${origin}/backend-api/accounts/check/v4-2023-04-27`, { method: 'GET' })
			},
			{
				source: 'user_settings',
				run: () => fetchJson(`${origin}/backend-api/settings/user`, { method: 'GET' })
			},
			{
				source: 'codex_usage',
				run: () => fetchJson(`${origin}/backend-api/codex/usage`, { method: 'GET' })
			}
		];

		for (const candidate of candidates) {
			try {
				addSnapshot(candidate.source, await candidate.run());
			} catch {
				// Private endpoints vary by account and product surface.
			}
		}

		try {
			const session = await fetchJson(`${origin}/api/auth/session`, { method: 'GET' });
			const token = session?.accessToken || session?.access_token;
			if (token) {
				try {
					addSnapshot(
						'wham_usage',
						await fetchJson(`${origin}/backend-api/wham/usage`, {
							method: 'GET',
							headers: { authorization: `Bearer ${token}` }
						})
					);
				} catch {
					// Not available for every ChatGPT surface.
				}
			}
		} catch {
			// Session endpoint may be unavailable in some deployments.
		}

		return { snapshots };
	}

	async function handleEventStream(site, response) {
		try {
			const reader = response.clone().body?.getReader?.();
			if (!reader) return;
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split(/\r\n|\r|\n/);
				buffer = lines.pop() || '';
				for (const line of lines) {
					if (!line.startsWith('data:')) continue;
					const raw = line.slice(5).trim();
					if (!raw || raw === '[DONE]') {
						if (site === 'chatgpt') post('cc:generation_complete', { site });
						continue;
					}
					try {
						const json = JSON.parse(raw);
						if (site === 'claude' && json?.type === 'message_limit' && json.message_limit) {
							post('cc:message_limit', json.message_limit);
						}
						if (site === 'chatgpt') {
							if (containsLimitSignal(json)) post('cc:chatgpt_usage_signal', json);
							if (json?.type === 'message_stream_complete' || json?.type === 'done') {
								post('cc:generation_complete', { site });
							}
						}
					} catch {
						// ignore non-JSON event data
					}
				}
			}

			if (site === 'chatgpt') post('cc:generation_complete', { site });
		} catch {
			// best-effort; do not break streaming
		}
	}

	function containsLimitSignal(value, depth = 0) {
		if (!value || typeof value !== 'object' || depth > 7) return false;
		for (const key of Object.keys(value)) {
			const k = key.toLowerCase();
			if (
				k.includes('usage') ||
				k.includes('limit') ||
				k.includes('quota') ||
				k.includes('cap') ||
				k.includes('remaining') ||
				k.includes('reset')
			) {
				return true;
			}
		}
		return Object.values(value).some((child) => containsLimitSignal(child, depth + 1));
	}

	window.addEventListener('message', async (event) => {
		if (event.source !== window) return;
		const data = event.data;
		if (!data || data.cc !== CC_MARKER) return;
		if (data.type !== 'cc:request') return;

		const { requestId, kind, payload } = data;
		try {
			if (kind === 'hash') {
				const text = typeof payload?.text === 'string' ? payload.text : '';
				if (!text || !crypto?.subtle?.digest) {
					postResponse(requestId, false, null, 'Hash unavailable');
					return;
				}
				const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
				const bytes = new Uint8Array(buffer);
				const hash = Array.from(bytes.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
				postResponse(requestId, true, { hash }, null);
				return;
			}

			if (kind === 'usage') {
				const orgId = payload?.orgId;
				if (!orgId) throw new Error('Missing orgId');
				const res = await originalFetch(`https://claude.ai/api/organizations/${orgId}/usage`, {
					method: 'GET',
					credentials: 'include'
				});
				const json = await res.json();
				postResponse(requestId, true, json, null);
				return;
			}

			if (kind === 'conversation') {
				const orgId = payload?.orgId;
				const conversationId = payload?.conversationId;
				if (!orgId || !conversationId) throw new Error('Missing orgId/conversationId');

				const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=true&rendering_mode=messages&render_all_tools=true`;
				const res = await originalFetch(url, {
					method: 'GET',
					credentials: 'include'
				});
				const json = await res.json();
				post('cc:conversation', { site: 'claude', orgId, conversationId, data: json });
				postResponse(requestId, true, json, null);
				return;
			}

			if (kind === 'chatgpt_conversation') {
				const conversationId = payload?.conversationId;
				if (!conversationId) throw new Error('Missing conversationId');
				const res = await originalFetch(`${window.location.origin}/backend-api/conversation/${conversationId}`, {
					method: 'GET',
					credentials: 'include'
				});
				const json = await res.json();
				post('cc:conversation', { site: 'chatgpt', conversationId, data: json });
				postResponse(requestId, true, json, null);
				return;
			}

			if (kind === 'chatgpt_usage') {
				postResponse(requestId, true, await requestChatGptUsageSnapshots(), null);
				return;
			}

			throw new Error(`Unknown request kind: ${kind}`);
		} catch (e) {
			postResponse(requestId, false, null, e?.message || String(e));
		}
	});
})();
