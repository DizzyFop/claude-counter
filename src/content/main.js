(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});
	if (CC.__started) return;
	CC.__started = true;

	const USAGE_POLL_MS = 30 * 1000;
	const site = CC.sites?.current?.();
	if (!site) return;

	function waitForElement(getElement, timeoutMs) {
		return new Promise((resolve) => {
			const existing = getElement();
			if (existing) {
				resolve(existing);
				return;
			}

			let timeoutId;
			const observer = new MutationObserver(() => {
				const el = getElement();
				if (el) {
					if (timeoutId) clearTimeout(timeoutId);
					observer.disconnect();
					resolve(el);
				}
			});

			observer.observe(document.body, { childList: true, subtree: true });

			if (timeoutMs) {
				timeoutId = setTimeout(() => {
					observer.disconnect();
					resolve(null);
				}, timeoutMs);
			}
		});
	}

	CC.waitForElement = (selector, timeoutMs) => waitForElement(() => document.querySelector(selector), timeoutMs);

	function observeUrlChanges(callback) {
		let lastPath = window.location.pathname;

		const fireIfChanged = () => {
			const current = window.location.pathname;
			if (current !== lastPath) {
				lastPath = current;
				callback();
			}
		};

		window.addEventListener('cc:urlchange', fireIfChanged);
		window.addEventListener('popstate', fireIfChanged);

		return () => {
			window.removeEventListener('cc:urlchange', fireIfChanged);
			window.removeEventListener('popstate', fireIfChanged);
		};
	}

	function parseClaudeUsageEndpoint(raw) {
		if (!raw || typeof raw !== 'object') return null;

		const normalizeWindow = (w, hours) => {
			if (!w || typeof w !== 'object') return null;
			if (typeof w.utilization !== 'number' || !Number.isFinite(w.utilization)) return null;
			const utilization = Math.max(0, Math.min(100, w.utilization));
			const resets_at = typeof w.resets_at === 'string' ? w.resets_at : null;
			return { utilization, resets_at, window_hours: hours };
		};

		const fiveHour = normalizeWindow(raw.five_hour, 5);
		const sevenDay = normalizeWindow(raw.seven_day, 24 * 7);

		if (!fiveHour && !sevenDay) return null;
		return { five_hour: fiveHour, seven_day: sevenDay };
	}

	function parseClaudeMessageLimit(raw) {
		if (!raw?.windows || typeof raw.windows !== 'object') return null;

		const normalizeWindow = (w, hours) => {
			if (!w || typeof w !== 'object') return null;
			if (typeof w.utilization !== 'number' || !Number.isFinite(w.utilization)) return null;
			const utilization = Math.max(0, Math.min(100, w.utilization * 100));
			const resets_at = typeof w.resets_at === 'number' && Number.isFinite(w.resets_at)
				? new Date(w.resets_at * 1000).toISOString()
				: null;
			return { utilization, resets_at, window_hours: hours };
		};

		const fiveHour = normalizeWindow(raw.windows['5h'], 5);
		const sevenDay = normalizeWindow(raw.windows['7d'], 24 * 7);

		if (!fiveHour && !sevenDay) return null;
		return { five_hour: fiveHour, seven_day: sevenDay };
	}

	function getCaseInsensitive(obj, names) {
		if (!obj || typeof obj !== 'object') return undefined;
		for (const [key, value] of Object.entries(obj)) {
			const normalized = key.toLowerCase();
			if (names.some((name) => normalized === name || normalized.includes(name))) return value;
		}
		return undefined;
	}

	function toFiniteNumber(value) {
		if (typeof value === 'number' && Number.isFinite(value)) return value;
		if (typeof value === 'string') {
			const parsed = Number(value.replace(/,/g, '').trim());
			if (Number.isFinite(parsed)) return parsed;
		}
		return null;
	}

	function toResetIso(value, key = '') {
		if (typeof value === 'string') {
			const ms = Date.parse(value);
			return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
		}
		if (typeof value !== 'number' || !Number.isFinite(value)) return null;

		const normalizedKey = key.toLowerCase();
		if (normalizedKey.includes('ms') || normalizedKey.includes('millisecond')) {
			return new Date(Date.now() + value).toISOString();
		}
		if (normalizedKey.includes('after') || value < 100000000) {
			return new Date(Date.now() + value * 1000).toISOString();
		}
		if (value > 1000000000000) return new Date(value).toISOString();
		if (value > 1000000000) return new Date(value * 1000).toISOString();
		return null;
	}

	function findResetIso(obj) {
		if (!obj || typeof obj !== 'object') return null;
		for (const [key, value] of Object.entries(obj)) {
			const k = key.toLowerCase();
			if (!k.includes('reset') && !k.includes('resets')) continue;
			const iso = toResetIso(value, key);
			if (iso) return iso;
		}
		return null;
	}

	function inferWindowHours(obj, path) {
		const explicitHours = toFiniteNumber(getCaseInsensitive(obj, ['window_hours', 'hours']));
		if (explicitHours && explicitHours > 0) return explicitHours;

		const seconds = toFiniteNumber(getCaseInsensitive(obj, ['window_seconds', 'period_seconds']));
		if (seconds && seconds > 0) return seconds / 3600;

		const p = path.toLowerCase();
		if (p.includes('weekly') || p.includes('week') || p.includes('7d')) return 24 * 7;
		if (p.includes('daily') || p.includes('day') || p.includes('24h')) return 24;
		const hourMatch = p.match(/(\d+)\s*h/);
		if (hourMatch) return Number(hourMatch[1]);
		return null;
	}

	function normalizeExactChatGptWindow(obj, path) {
		if (!obj || typeof obj !== 'object') return null;

		let utilization = toFiniteNumber(getCaseInsensitive(obj, ['utilization', 'usage_percent', 'used_percent', 'percent', 'percentage']));
		if (typeof utilization === 'number') {
			utilization = utilization <= 1 ? utilization * 100 : utilization;
		} else {
			const limit = toFiniteNumber(getCaseInsensitive(obj, ['message_cap', 'message_limit', 'limit', 'max', 'total']));
			const remaining = toFiniteNumber(getCaseInsensitive(obj, ['remaining', 'remaining_messages']));
			const used = toFiniteNumber(getCaseInsensitive(obj, ['used', 'current', 'count']));
			if (typeof limit === 'number' && limit > 0) {
				if (typeof used === 'number') {
					utilization = (used / limit) * 100;
				} else if (typeof remaining === 'number') {
					utilization = ((limit - remaining) / limit) * 100;
				}
			}
		}

		const resets_at = findResetIso(obj);
		if (typeof utilization !== 'number' || !Number.isFinite(utilization) || !resets_at) return null;

		const window_hours = inferWindowHours(obj, path);
		return {
			utilization: Math.max(0, Math.min(100, utilization)),
			resets_at,
			window_hours,
			label: window_hours && window_hours >= 24 * 7 ? 'Weekly' : 'Session'
		};
	}

	function collectChatGptWindows(value, path = '', depth = 0, out = [], seen = new WeakSet()) {
		if (!value || typeof value !== 'object' || depth > 8 || seen.has(value)) return out;
		seen.add(value);

		const normalized = normalizeExactChatGptWindow(value, path);
		if (normalized) out.push(normalized);

		for (const [key, child] of Object.entries(value)) {
			if (child && typeof child === 'object') {
				collectChatGptWindows(child, path ? `${path}.${key}` : key, depth + 1, out, seen);
			}
		}
		return out;
	}

	function parseChatGptUsageSignal(raw) {
		const values = raw?.snapshots?.map((snapshot) => snapshot.payload).filter(Boolean) || [raw];
		const windows = values.flatMap((value) => collectChatGptWindows(value));
		if (!windows.length) return null;

		const weekly = windows.find((w) => w.window_hours && w.window_hours >= 24 * 7) || null;
		const session =
			windows.find((w) => !w.window_hours || w.window_hours < 24 * 7) ||
			(!weekly ? windows[0] : null);

		if (!session && !weekly) return null;
		return {
			five_hour: session || null,
			seven_day: weekly || null
		};
	}

	function formatUsageReset(iso) {
		if (!iso) return '';
		const ms = Date.parse(iso);
		if (!Number.isFinite(ms)) return '';
		const diffMs = ms - Date.now();
		if (diffMs <= 0) return 'reset now';
		const minutes = Math.round(diffMs / 60000);
		if (minutes < 60) return `resets in ${minutes}m`;
		const hours = Math.floor(minutes / 60);
		const remMinutes = minutes % 60;
		if (hours < 24) return `resets in ${hours}h ${remMinutes}m`;
		const days = Math.floor(hours / 24);
		return `resets in ${days}d ${hours % 24}h`;
	}

	function collectChatGptUsageNotes(value, path = '', depth = 0, out = [], seen = new WeakSet()) {
		if (!value || typeof value !== 'object' || depth > 8 || seen.has(value)) return out;
		seen.add(value);

		const remaining = toFiniteNumber(getCaseInsensitive(value, ['remaining', 'remaining_messages', 'remaining_uses', 'uses_remaining']));
		const limit = toFiniteNumber(getCaseInsensitive(value, ['message_cap', 'message_limit', 'limit', 'max', 'total', 'total_uses']));
		const used = toFiniteNumber(getCaseInsensitive(value, ['used', 'current', 'count', 'used_count', 'used_uses']));
		const label =
			getCaseInsensitive(value, ['feature_name', 'model_slug', 'model', 'name', 'slug']) ||
			path.split('.').filter(Boolean).pop() ||
			'usage';
		const resetText = formatUsageReset(findResetIso(value));

		if (typeof remaining === 'number') {
			const limitText = typeof limit === 'number' ? `/${limit}` : '';
			const text = `${String(label).replace(/_/g, ' ')}: ${remaining}${limitText} remaining${resetText ? ` · ${resetText}` : ''}`;
			if (!out.includes(text)) out.push(text);
		} else if (typeof used === 'number' && typeof limit === 'number' && limit > 0) {
			const text = `${String(label).replace(/_/g, ' ')}: ${used}/${limit} used${resetText ? ` · ${resetText}` : ''}`;
			if (!out.includes(text)) out.push(text);
		}

		for (const [key, child] of Object.entries(value)) {
			if (child && typeof child === 'object') {
				collectChatGptUsageNotes(child, path ? `${path}.${key}` : key, depth + 1, out, seen);
			}
		}
		return out;
	}

	function parseChatGptUsageStatus(raw) {
		const values = raw?.snapshots?.map((snapshot) => snapshot.payload).filter(Boolean) || [raw];
		const notes = values.flatMap((value) => collectChatGptUsageNotes(value));
		if (notes.length) return `Usage: ${notes.slice(0, 2).join(' · ')}`;
		return '';
	}

	let currentConversationId = null;
	let currentOrgId = null;

	let usageState = null;
	let usageResetMs = { five_hour: null, seven_day: null };
	let lastUsageSseMs = 0;
	let usageFetchInFlight = false;
	let lastUsageUpdateMs = 0;
	let lastStructuredConversationId = null;
	let lastStructuredConversationMs = 0;
	let visibleFallbackTimer = null;
	const rolloverHandledForResetMs = { five_hour: null, seven_day: null };

	const ui = new CC.ui.CounterUI({
		site,
		onUsageRefresh: async () => refreshUsage()
	});
	ui.initialize();

	const bridgeReady = CC.injectBridgeOnce();

	function sameSite(payload) {
		return !payload?.site || payload.site === site.id;
	}

	function applyUsageUpdate(normalized, source) {
		if (!normalized) return;
		const now = Date.now();
		usageState = normalized;
		lastUsageUpdateMs = now;
		if (source === 'sse') lastUsageSseMs = now;
		usageResetMs.five_hour = normalized.five_hour?.resets_at ? Date.parse(normalized.five_hour.resets_at) : null;
		usageResetMs.seven_day = normalized.seven_day?.resets_at ? Date.parse(normalized.seven_day.resets_at) : null;
		ui.setUsage(normalized);
	}

	function updateOrgIdIfNeeded(newOrgId) {
		if (newOrgId && typeof newOrgId === 'string' && newOrgId !== currentOrgId) {
			currentOrgId = newOrgId;
		}
	}

	async function refreshUsage() {
		await bridgeReady;
		if (site.id === 'chatgpt') {
			if (usageFetchInFlight) return;
			usageFetchInFlight = true;
			let raw;
			try {
				raw = await CC.bridge.requestChatGptUsage();
			} catch {
				ui.setUsageStatus('');
				return;
			} finally {
				usageFetchInFlight = false;
			}

			const parsed = parseChatGptUsageSignal(raw);
			if (parsed) {
				applyUsageUpdate(parsed, 'usage');
			} else {
				ui.setUsageStatus(parseChatGptUsageStatus(raw));
			}
			return;
		}

		const orgId = currentOrgId || site.getOrgId?.();
		if (!orgId) return;
		updateOrgIdIfNeeded(orgId);

		if (usageFetchInFlight) return;
		usageFetchInFlight = true;
		let raw;
		try {
			raw = await CC.bridge.requestUsage(orgId);
		} catch {
			return;
		} finally {
			usageFetchInFlight = false;
		}

		applyUsageUpdate(parseClaudeUsageEndpoint(raw), 'usage');
	}

	async function refreshConversation() {
		await bridgeReady;
		if (!currentConversationId) {
			ui.setConversationMetrics();
			return;
		}

		if (site.id === 'claude') {
			const orgId = currentOrgId || site.getOrgId?.();
			if (!orgId) return;
			updateOrgIdIfNeeded(orgId);

			try {
				await CC.bridge.requestConversation(orgId, currentConversationId);
			} catch {
				// ignore
			}
			return;
		}

		try {
			await CC.bridge.requestChatGptConversation(currentConversationId);
		} catch {
			scheduleVisibleChatGptFallback();
		}
	}

	function scheduleVisibleChatGptFallback(delayMs = 1200) {
		if (site.id !== 'chatgpt' || !currentConversationId) return;
		if (visibleFallbackTimer) clearTimeout(visibleFallbackTimer);
		visibleFallbackTimer = setTimeout(async () => {
			visibleFallbackTimer = null;
			if (lastStructuredConversationId === currentConversationId && Date.now() - lastStructuredConversationMs < 5000) return;
			const metrics = await CC.tokens.computeVisibleChatGptMetrics();
			if (metrics.trunkMessageCount > 0) ui.setConversationMetrics(metrics);
		}, delayMs);
	}

	function handleGenerationStart(payload) {
		if (!sameSite(payload)) return;
		if (site.id === 'claude') {
			if (!currentConversationId) return;
			ui.setPendingCache(true);
		}
		if (site.id === 'chatgpt') {
			if (currentConversationId) scheduleVisibleChatGptFallback(2500);
		}
	}

	function handleGenerationComplete(payload) {
		if (!sameSite(payload) || site.id !== 'chatgpt') return;
		refreshConversation();
		refreshUsage();
		scheduleVisibleChatGptFallback(1800);
	}

	async function handleConversationPayload({ site: payloadSite, orgId, conversationId, data }) {
		if (payloadSite && payloadSite !== site.id) return;
		if (!conversationId || conversationId !== currentConversationId) return;
		updateOrgIdIfNeeded(orgId);
		if (!data) return;

		const metrics = await CC.tokens.computeConversationMetrics(data, { siteId: site.id });
		if (site.id === 'chatgpt') {
			lastStructuredConversationId = conversationId;
			lastStructuredConversationMs = Date.now();
		}
		ui.setConversationMetrics(metrics);
	}

	function handleClaudeMessageLimit(messageLimit) {
		if (site.id !== 'claude') return;
		applyUsageUpdate(parseClaudeMessageLimit(messageLimit), 'sse');
	}

	function handleChatGptUsageSignal(raw) {
		if (site.id !== 'chatgpt') return;
		const parsed = parseChatGptUsageSignal(raw);
		if (parsed) applyUsageUpdate(parsed, 'sse');
		else if (!usageState) ui.setUsageStatus(parseChatGptUsageStatus(raw));
	}

	CC.bridge.on('cc:generation_start', handleGenerationStart);
	CC.bridge.on('cc:generation_complete', handleGenerationComplete);
	CC.bridge.on('cc:conversation', handleConversationPayload);
	CC.bridge.on('cc:message_limit', handleClaudeMessageLimit);
	CC.bridge.on('cc:chatgpt_usage_signal', handleChatGptUsageSignal);

	async function handleUrlChange() {
		const previousConversationId = currentConversationId;
		currentConversationId = site.getConversationId?.() || null;

		ui.attach();
		waitForElement(() => site.findUsageAnchor?.(), 60000).then((el) => {
			if (el) ui.attachUsageLine();
		});
		waitForElement(() => site.findHeaderAnchor?.(), 60000).then((el) => {
			if (el) ui.attachHeader();
		});

		if (previousConversationId !== currentConversationId) {
			lastStructuredConversationId = null;
			lastStructuredConversationMs = 0;
		}

		if (!currentConversationId) {
			ui.setConversationMetrics();
			return;
		}

		updateOrgIdIfNeeded(site.getOrgId?.());
		await refreshConversation();

		if ((site.id === 'claude' || site.id === 'chatgpt') && !usageState) await refreshUsage();
		if (site.id === 'chatgpt') scheduleVisibleChatGptFallback();
	}

	const unobserveUrl = observeUrlChanges(handleUrlChange);
	window.addEventListener('beforeunload', unobserveUrl);

	document.addEventListener('click', (e) => {
		if (!currentConversationId) return;
		const btn = e.target.closest('button[aria-label="Previous"], button[aria-label="Next"], button[aria-label*="Retry"], button[aria-label*="Regenerate"]');
		if (!btn) return;
		setTimeout(() => refreshConversation(), 800);
		if (site.id === 'chatgpt') scheduleVisibleChatGptFallback(1600);
	});

	handleUrlChange();

	function tick() {
		ui.tick();
		const now = Date.now();

		if (site.id === 'claude') {
			if (usageResetMs.five_hour && now >= usageResetMs.five_hour && rolloverHandledForResetMs.five_hour !== usageResetMs.five_hour) {
				rolloverHandledForResetMs.five_hour = usageResetMs.five_hour;
				refreshUsage();
			}
			if (usageResetMs.seven_day && now >= usageResetMs.seven_day && rolloverHandledForResetMs.seven_day !== usageResetMs.seven_day) {
				rolloverHandledForResetMs.seven_day = usageResetMs.seven_day;
				refreshUsage();
			}

			const ONE_HOUR_MS = 60 * 60 * 1000;
			const sseAge = now - lastUsageSseMs;
			const anyAge = now - lastUsageUpdateMs;
			if (!document.hidden && sseAge > ONE_HOUR_MS && anyAge > ONE_HOUR_MS) {
				refreshUsage();
			}
		}
	}

	setInterval(tick, 1000);

	if (site.id === 'claude') {
		setInterval(() => {
			if (document.hidden) return;
			refreshUsage();
		}, USAGE_POLL_MS);
	}

	if (site.id === 'chatgpt') {
		ui.setUsageStatus('');
		refreshUsage();
		setInterval(() => {
			if (document.hidden || lastStructuredConversationId === currentConversationId) return;
			scheduleVisibleChatGptFallback(0);
		}, 5000);
		setInterval(() => {
			if (document.hidden) return;
			refreshUsage();
		}, 60 * 1000);
	}
})();
