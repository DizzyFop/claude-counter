(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	function formatSeconds(totalSeconds) {
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes}:${String(seconds).padStart(2, '0')}`;
	}

	function formatResetCountdown(timestampMs) {
		// <= 0: reset time reached
		const diffMs = timestampMs - Date.now();
		if (diffMs <= 0) return '0s';

		// < 1 min: show seconds
		const totalSeconds = Math.floor(diffMs / 1000);
		if (totalSeconds < 60) return `${totalSeconds}s`;

		// < 1 hour: show minutes
		const totalMinutes = Math.round(totalSeconds / 60);
		if (totalMinutes < 60) return `${totalMinutes}m`;

		// < 1 day: show hours
		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		if (hours < 24) return `${hours}h ${minutes}m`;

		// >= 1 day: show days
		const days = Math.floor(hours / 24);
		const remHours = hours % 24;
		return `${days}d ${remHours}h`;
	}

	// Round to the nearest minute so sub-minute rounding differences between the
	// two usage sources (SSE message_limit vs. /usage endpoint) don't flip the display.
	function roundToMinute(timestampMs) {
		return new Date(Math.round(timestampMs / 60000) * 60000);
	}

	function formatClockTime(timestampMs) {
		return roundToMinute(timestampMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
	}

	function formatDayTime(timestampMs) {
		return roundToMinute(timestampMs).toLocaleString([], {
			weekday: 'long',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
		});
	}

	function formatTokenLimit(tokens) {
		return tokens >= 1000000 ? `${tokens / 1000000}M` : `${Math.round(tokens / 1000)}K`;
	}

	function tokenTooltipText(contextLimit) {
		const lines = [
			"Approximate, not Claude's exact count.",
			'Text uses a generic tokenizer, scaled up for newer models. Images and PDFs are estimated by size.',
			"Excludes the hidden system prompt, tools, and Claude's thinking, so the real count is higher.",
			'Invalid once Claude compacts the chat.'
		];
		if (contextLimit) {
			lines.push(`The bar fills at ${formatTokenLimit(contextLimit)} tokens, this model's context window.`);
		}
		return lines.join('\n');
	}

	function setupTooltip(element, tooltip, { topOffset = 10, getText = null, anchor = null } = {}) {
		if (!element || !tooltip) return;
		if (element.hasAttribute('data-tooltip-setup')) return;
		element.setAttribute('data-tooltip-setup', 'true');
		element.classList.add('cc-tooltipTrigger');

		let pressTimer;
		let hideTimer;

		const show = () => {
			if (getText) {
				const text = getText();
				if (text) tooltip.textContent = text;
			}
			const rect = (anchor || element).getBoundingClientRect();
			tooltip.style.opacity = '1';
			const tipRect = tooltip.getBoundingClientRect();

			let left = rect.left + rect.width / 2;
			if (left + tipRect.width / 2 > window.innerWidth) left = window.innerWidth - tipRect.width / 2 - 10;
			if (left - tipRect.width / 2 < 0) left = tipRect.width / 2 + 10;

			let top = rect.top - tipRect.height - topOffset;
			if (top < 10) top = rect.bottom + 10;

			tooltip.style.left = `${left}px`;
			tooltip.style.top = `${top}px`;
			tooltip.style.transform = 'translateX(-50%)';
		};

		const hide = () => {
			tooltip.style.opacity = '0';
			clearTimeout(hideTimer);
		};

		element.addEventListener('pointerdown', (e) => {
			if (e.pointerType === 'touch' || e.pointerType === 'pen') {
				pressTimer = setTimeout(() => {
					show();
					hideTimer = setTimeout(hide, 3000);
				}, 500);
			}
		});

		element.addEventListener('pointerup', () => clearTimeout(pressTimer));
		element.addEventListener('pointercancel', () => {
			clearTimeout(pressTimer);
			hide();
		});

		element.addEventListener('pointerenter', (e) => {
			if (e.pointerType === 'mouse') show();
		});

		element.addEventListener('pointerleave', (e) => {
			if (e.pointerType === 'mouse') hide();
		});
	}

	function makeTooltip(text) {
		const tip = document.createElement('div');
		tip.className = 'bg-bg-500 text-text-000 cc-tooltip';
		tip.textContent = text;
		document.body.appendChild(tip);
		return tip;
	}

	// --- Usage designs ---
	// setUsage() boils claude.ai's data down to { session, weekly, fable }. session and weekly are
	// { pct, width, resetMs, startMs } or null; fable is { pct, width, name, state } or null.
	// The active design renders from it on every update and every tick.

	function windowText(label, w, extra = '') {
		const reset = w.resetMs ? ` · resets in ${formatResetCountdown(w.resetMs)}` : '';
		return `${label}: ${w.pct}%${extra}${reset}`;
	}

	const sessionTooltipText = (w) => (w?.resetMs ? `Resets at ${formatClockTime(w.resetMs)}` : '5-hour session window');
	const weeklyTooltipText = (w) => (w?.resetMs ? `Resets ${formatDayTime(w.resetMs)}` : '7-day usage window');

	// How far into the window "now" is, for the white marker.
	function elapsedPct(w) {
		if (!w?.startMs || !w.resetMs) return null;
		const total = w.resetMs - w.startMs;
		const elapsed = Math.max(0, Math.min(total, Date.now() - w.startMs));
		return total > 0 ? (elapsed / total) * 100 : 0;
	}

	function renderFill(fill, w) {
		fill.style.width = `${w ? w.width : 0}%`;
		fill.classList.toggle('cc-warn', !!w && w.width >= 90);
	}

	function renderFableFill(fill, fable) {
		fill.style.width = `${fable ? fable.width : 0}%`;
		fill.classList.toggle('cc-warn', fable?.state === 'warn');
		fill.classList.toggle('cc-crit', fable?.state === 'crit');
	}

	function renderMarker(marker, w) {
		const pct = elapsedPct(w);
		marker.classList.toggle('cc-hidden', pct == null);
		if (pct != null) marker.style.left = `${pct}%`;
	}

	function applyBarChrome(el, chrome, fillWarn) {
		el.style.setProperty('--cc-stroke', chrome.strokeColor);
		el.style.setProperty('--cc-fill', chrome.fillColor);
		el.style.setProperty('--cc-fill-warn', fillWarn ?? chrome.fillColor);
		el.style.setProperty('--cc-marker', chrome.markerColor);
	}

	// Fable: teal (normal) → gold (warning) → red (critical), tracking claude.ai's severity
	// so the color matches what the app shows.
	function applyFableChrome(el, chrome) {
		el.style.setProperty('--cc-fill-fable', chrome.fableColor);
		el.style.setProperty('--cc-fill-fable-warn', chrome.fableWarnColor);
		el.style.setProperty('--cc-fill-fable-crit', CC.COLORS.RED_WARNING);
	}

	function make(tag, className, ...children) {
		const node = document.createElement(tag);
		node.className = className;
		node.append(...children);
		return node;
	}

	// The original design: a row of two outlined bars inside the bottom of the message box.
	// The weekly bar splits in half when there's a Fable limit.
	class BarsView {
		constructor(ui) {
			this.sessionText = make('span', 'cc-usageText');
			this.sessionFill = make('div', 'cc-bar__fill');
			this.sessionMarker = make('div', 'cc-bar__marker cc-hidden');
			this.sessionBar = make('div', 'cc-bar cc-bar--usage', this.sessionFill, this.sessionMarker);

			this.weeklyText = make('span', 'cc-usageText');
			this.weeklyFill = make('div', 'cc-bar__fill cc-bar__fill--top');
			this.fableFill = make('div', 'cc-bar__fill cc-bar__fill--bottom');
			this.weeklyMarker = make('div', 'cc-bar__marker cc-hidden');
			this.weeklyBar = make('div', 'cc-bar cc-bar--usage', this.weeklyFill, this.fableFill, this.weeklyMarker);

			this.sessionGroup = make('div', 'cc-usageGroup', this.sessionText, this.sessionBar);
			this.weeklyGroup = make('div', 'cc-usageGroup cc-usageGroup--weekly', this.weeklyBar, this.weeklyText);

			this.root = make(
				'div',
				'text-text-400 text-[11px] cc-usageRow cc-hidden flex flex-row items-center gap-3 w-full',
				this.sessionGroup,
				this.weeklyGroup
			);
			ui.bindUsageRefresh(this.root, 'cc-usageRow--dim');

			setupTooltip(this.sessionGroup, makeTooltip(''), {
				topOffset: 8,
				anchor: this.sessionBar,
				getText: () => sessionTooltipText(ui.usage.session)
			});
			setupTooltip(this.weeklyGroup, makeTooltip(''), {
				topOffset: 8,
				anchor: this.weeklyBar,
				getText: () => {
					const { weekly, fable } = ui.usage;
					const base = weeklyTooltipText(weekly);
					return fable ? `All models: ${weekly.pct}% · ${fable.name}: ${fable.pct}%\n${base}` : base;
				}
			});
		}

		// The action buttons are absolutely positioned inside the box, so the row has to be
		// the box's last child to land under them instead of on top of them.
		attach(box) {
			if (box.lastElementChild !== this.root) box.appendChild(this.root);
		}

		detach() {
			this.root.remove();
		}

		applyChrome(chrome) {
			applyBarChrome(this.sessionBar, chrome, CC.COLORS.RED_WARNING);
			applyBarChrome(this.weeklyBar, chrome, CC.COLORS.RED_WARNING);
			applyFableChrome(this.weeklyBar, chrome);
		}

		render({ session, weekly, fable }) {
			this.root.classList.toggle('cc-hidden', !session && !weekly);

			this.sessionText.textContent = session ? windowText('Session', session) : '';
			renderFill(this.sessionFill, session);
			this.sessionFill.classList.toggle('cc-full', !!session && session.width >= 99.5);
			renderMarker(this.sessionMarker, session);

			this.weeklyGroup.classList.toggle('cc-hidden', !weekly);
			this.sessionGroup.classList.toggle('cc-usageGroup--single', !weekly);
			this.weeklyText.textContent = weekly ? windowText('Weekly', weekly) : '';
			renderFill(this.weeklyFill, weekly);
			this.weeklyFill.classList.toggle('cc-full', !!weekly && weekly.width >= 99.5);
			renderMarker(this.weeklyMarker, weekly);

			this.weeklyBar.classList.toggle('cc-bar--split', !!fable);
			renderFableFill(this.fableFill, fable);
			this.fableFill.classList.toggle('cc-full', !!fable && fable.width >= 99.5);
		}
	}

	// Hairlines on the message box: session along the top edge, weekly (plus a Fable lane)
	// along the bottom. Labels sit above the box and show while it's hovered, or all the time
	// with the setting on. A line past 90% thickens and keeps its label up.
	class LinesView {
		constructor(ui) {
			this.sessionFill = make('div', 'cc-edge__fill');
			this.sessionMarker = make('div', 'cc-edge__marker cc-hidden');
			this.sessionEdge = make('div', 'cc-edge cc-edge--top', this.sessionFill, this.sessionMarker);

			this.weeklyFill = make('div', 'cc-edge__fill');
			this.fableFill = make('div', 'cc-edge__fill');
			this.weeklyMarker = make('div', 'cc-edge__marker cc-hidden');
			this.weeklyEdge = make(
				'div',
				'cc-edge cc-edge--bottom',
				make('div', 'cc-edge__lane', this.weeklyFill),
				make('div', 'cc-edge__lane cc-edge__lane--fable', this.fableFill),
				this.weeklyMarker
			);

			this.root = make('div', 'cc-edges cc-hidden', this.sessionEdge, this.weeklyEdge);

			this.sessionText = make('span', 'cc-edgeLabel');
			this.weeklyText = make('span', 'cc-edgeLabel');
			this.labels = make(
				'div',
				'text-text-400 text-[11px] cc-edgeLabels cc-hidden',
				this.sessionText,
				this.weeklyText
			);
			ui.bindUsageRefresh(this.labels, 'cc-edgeLabels--dim');

			setupTooltip(this.sessionText, makeTooltip(''), {
				topOffset: 8,
				getText: () => sessionTooltipText(ui.usage.session)
			});
			setupTooltip(this.weeklyText, makeTooltip(''), {
				topOffset: 8,
				getText: () => weeklyTooltipText(ui.usage.weekly)
			});
		}

		// Absolutely positioned against the box, which is already position: relative.
		attach(box) {
			if (this.root.parentElement !== box) box.append(this.root, this.labels);
		}

		detach() {
			this.root.remove();
			this.labels.remove();
		}

		setAlwaysShow(on) {
			this.labels.classList.toggle('cc-edgeLabels--always', !!on);
		}

		applyChrome(chrome) {
			applyBarChrome(this.root, chrome, CC.COLORS.RED_WARNING);
			applyFableChrome(this.root, chrome);
			this.root.style.setProperty('--cc-track', chrome.trackColor);
		}

		render({ session, weekly, fable }) {
			const hasAny = !!(session || weekly);
			this.root.classList.toggle('cc-hidden', !hasAny);
			this.labels.classList.toggle('cc-hidden', !hasAny);

			const sessionWarn = !!session && session.width >= 90;
			this.sessionText.textContent = session ? windowText('Session', session) : '';
			renderFill(this.sessionFill, session);
			renderMarker(this.sessionMarker, session);
			this.sessionEdge.classList.toggle('cc-edge--warn', sessionWarn);
			this.sessionText.classList.toggle('cc-show', sessionWarn);

			const weeklyWarn = !!weekly && (weekly.width >= 90 || fable?.state === 'crit');
			const fableText = fable ? ` · ${fable.name}: ${fable.pct}%` : '';
			this.weeklyEdge.classList.toggle('cc-hidden', !weekly);
			this.weeklyText.classList.toggle('cc-hidden', !weekly);
			this.weeklyText.textContent = weekly ? windowText('Weekly', weekly, fableText) : '';
			renderFill(this.weeklyFill, weekly);
			renderMarker(this.weeklyMarker, weekly);
			this.weeklyEdge.classList.toggle('cc-edge--split', !!fable);
			renderFableFill(this.fableFill, fable);
			this.weeklyEdge.classList.toggle('cc-edge--warn', weeklyWarn);
			this.weeklyText.classList.toggle('cc-show', weeklyWarn);
		}
	}

	class CounterUI {
		constructor({ onUsageRefresh } = {}) {
			this.onUsageRefresh = onUsageRefresh || null;

			this.headerContainer = null;
			this.headerDisplay = null;
			this.lengthGroup = null;
			this.lengthDisplay = null;
			this.cachedDisplay = null;
			this.lengthBar = null;
			this.lengthTooltip = null;
			this.lastCachedUntilMs = null;
			this.pendingCache = false;

			this.usage = { session: null, weekly: null, fable: null };
			this.usageStyle = CC.SETTINGS_DEFAULTS.usageStyle;
			this.views = null;
			this.refreshingUsage = false;

			this.domObserver = null;
		}

		getProgressChrome() {
			const root = document.documentElement;
			const modeDark = root.dataset?.mode === 'dark';
			const modeLight = root.dataset?.mode === 'light';
			const isDark = modeDark && !modeLight;

			return {
				strokeColor: isDark ? CC.COLORS.PROGRESS_OUTLINE_DARK : CC.COLORS.PROGRESS_OUTLINE_LIGHT,
				fillColor: isDark ? CC.COLORS.PROGRESS_FILL_DARK : CC.COLORS.PROGRESS_FILL_LIGHT,
				markerColor: isDark ? CC.COLORS.PROGRESS_MARKER_DARK : CC.COLORS.PROGRESS_MARKER_LIGHT,
				trackColor: isDark ? CC.COLORS.EDGE_TRACK_DARK : CC.COLORS.EDGE_TRACK_LIGHT,
				fableColor: isDark ? CC.COLORS.FABLE_FILL_DARK : CC.COLORS.FABLE_FILL_LIGHT,
				fableWarnColor: isDark ? CC.COLORS.FABLE_WARN_DARK : CC.COLORS.FABLE_WARN_LIGHT,
				boldColor: isDark ? CC.COLORS.BOLD_DARK : CC.COLORS.BOLD_LIGHT
			};
		}

		refreshProgressChrome() {
			const chrome = this.getProgressChrome();
			if (this.lengthBar) applyBarChrome(this.lengthBar, chrome);
			if (this.views) {
				for (const view of Object.values(this.views)) view.applyChrome(chrome);
			}
		}

		initialize() {
			// Header container (tokens + cache timer)
			this.headerContainer = document.createElement('div');
			this.headerContainer.className = 'text-text-500 text-xs !px-1 cc-header';

			this.headerDisplay = document.createElement('span');
			this.headerDisplay.className = 'cc-headerItem';

			this.lengthGroup = document.createElement('span');
			this.lengthDisplay = document.createElement('span');
			this.cachedDisplay = document.createElement('span');
			this.cacheTimeSpan = null; // reference to inner time span

			this.lengthGroup.appendChild(this.lengthDisplay);
			this.headerDisplay.appendChild(this.lengthGroup);

			// Usage display, in either design
			this.views = { bars: new BarsView(this), lines: new LinesView(this) };
			this.refreshProgressChrome();

			this._setupTooltips();
			this._observeDom();
			this._observeTheme();
		}

		_activeView() {
			return this.views ? this.views[this.usageStyle] : null;
		}

		// Clicking the usage text refreshes it from claude.ai.
		bindUsageRefresh(el, dimClass) {
			el.addEventListener('click', async () => {
				if (!this.onUsageRefresh || this.refreshingUsage) return;
				this.refreshingUsage = true;
				el.classList.add(dimClass);
				try {
					await this.onUsageRefresh();
				} finally {
					el.classList.remove(dimClass);
					this.refreshingUsage = false;
				}
			});
		}

		_observeTheme() {
			// Watch for theme changes (data-mode attribute on <html>)
			const observer = new MutationObserver(() => this.refreshProgressChrome());
			observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
		}

		_observeDom() {
			// Track pending reattach attempts independently
			let usageReattachPending = false;
			let headerReattachPending = false;

			this.domObserver = new MutationObserver(() => {
				const usageMissing = this.views && !document.contains(this._activeView().root);
				const headerMissing = !document.contains(this.headerContainer);

				if (usageMissing && !usageReattachPending) {
					usageReattachPending = true;
					CC.waitForElement(CC.DOM.COMPOSER, 60000).then((el) => {
						usageReattachPending = false;
						if (el) this.attachUsageLine();
					});
				}

				if (headerMissing && !headerReattachPending) {
					headerReattachPending = true;
					CC.waitForElement(CC.DOM.CHAT_TITLE_SPLIT, 60000).then((el) => {
						headerReattachPending = false;
						if (el) this.attachHeader();
					});
				}
			});
			this.domObserver.observe(document.body, { childList: true, subtree: true });
		}

		_setupTooltips() {
			this.lengthTooltip = makeTooltip(tokenTooltipText(null));
			setupTooltip(
				this.lengthGroup,
				this.lengthTooltip,
				{ topOffset: 8 }
			);

			setupTooltip(
				this.cachedDisplay,
				makeTooltip(
					"Estimated time left on Claude's prompt cache. Each reply restarts it.\nclaude.ai doesn't publish the length. Community testing found about an hour.\nReplying while it's cached uses less of your usage limit. Editing a message or changing the model or effort starts over."
				),
				{ topOffset: 8 }
			);
		}

		attach() {
			this.attachHeader();
			this.attachUsageLine();
			this.refreshProgressChrome();
		}

		attachHeader() {
			const titleSplit = document.querySelector(CC.DOM.CHAT_TITLE_SPLIT);
			if (!titleSplit) return;
			if (titleSplit.nextElementSibling !== this.headerContainer) {
				titleSplit.after(this.headerContainer);
			}
			this._renderHeader();
			this.refreshProgressChrome();
		}

		attachUsageLine() {
			if (!this.views) return;
			const composer = document.querySelector(CC.DOM.COMPOSER);
			if (!composer) return;

			// The composer is two stacked parts: the input box, and the chin below it
			// (disclaimer, model selector). Both designs go inside the box.
			const actions = composer.querySelector(CC.DOM.COMPOSER_ACTIONS);
			const children = Array.from(composer.children);
			const box =
				(actions ? children.find((el) => el.contains(actions)) : null) ||
				children.find((el) => !el.matches(`${CC.DOM.COMPOSER_CHIN}, .cc-usageRow, .cc-edges, .cc-edgeLabels`));
			const host = box || composer;

			const active = this._activeView();
			for (const view of Object.values(this.views)) {
				if (view !== active) view.detach();
			}
			active.attach(host);
			this.refreshProgressChrome();
		}

		setUsageStyle(style) {
			const next = style === 'bars' ? 'bars' : 'lines';
			if (next === this.usageStyle) return;
			this.usageStyle = next;
			this.attachUsageLine();
			this._activeView()?.render(this.usage);
		}

		setAlwaysShowLabels(on) {
			this.views?.lines.setAlwaysShow(on);
		}

		setPendingCache(pending) {
			this.pendingCache = pending;
			if (this.cacheTimeSpan) {
				if (pending) {
					this.cacheTimeSpan.style.color = '';
				} else {
					const { boldColor } = this.getProgressChrome();
					this.cacheTimeSpan.style.color = boldColor;
				}
			}
		}

		setConversationMetrics({ totalTokens, cachedUntil, contextLimit } = {}) {
			this.pendingCache = false;

			if (typeof totalTokens !== 'number') {
				this.lengthDisplay.textContent = '';
				this.cachedDisplay.textContent = '';
				this.lastCachedUntilMs = null;
				this._renderHeader();
				return;
			}

			const limit = contextLimit || CC.CONST.CONTEXT_LIMIT_TOKENS;
			const pct = Math.max(0, Math.min(100, (totalTokens / limit) * 100));
			this.lengthDisplay.textContent = `~${totalTokens.toLocaleString()} tokens`;

			// Mini bar (hide when full - context is definitely compacted by then)
			const isFull = pct >= 99.5;
			if (this.lengthTooltip) {
				this.lengthTooltip.textContent = tokenTooltipText(isFull ? null : limit);
			}
			if (isFull) {
				this.lengthDisplay.style.opacity = '0.5';
				this.lengthBar = null;
				this.lengthGroup.replaceChildren(this.lengthDisplay);
			} else {
				this.lengthDisplay.style.opacity = '';
				const bar = document.createElement('div');
				bar.className = 'cc-bar cc-bar--mini';
				this.lengthBar = bar;
				const fill = document.createElement('div');
				fill.className = 'cc-bar__fill';
				fill.style.width = `${pct}%`;
				bar.appendChild(fill);
				this.refreshProgressChrome();

				const barContainer = document.createElement('span');
				barContainer.className = 'inline-flex items-center';
				barContainer.appendChild(bar);

				this.lengthGroup.replaceChildren(this.lengthDisplay, document.createTextNode('\u00A0\u00A0'), barContainer);
			}

			// Cache timer
			const now = Date.now();
			if (typeof cachedUntil === 'number' && cachedUntil > now) {
				this.lastCachedUntilMs = cachedUntil;
				const secondsLeft = Math.max(0, Math.ceil((cachedUntil - now) / 1000));
				const { boldColor } = this.getProgressChrome();
				this.cacheTimeSpan = Object.assign(document.createElement('span'), {
					className: 'cc-cacheTime',
					textContent: formatSeconds(secondsLeft)
				});
				this.cacheTimeSpan.style.color = boldColor;
				this.cachedDisplay.replaceChildren(document.createTextNode('cached for\u00A0'), this.cacheTimeSpan);
			} else {
				this.lastCachedUntilMs = null;
				this.cacheTimeSpan = null;
				this.cachedDisplay.textContent = '';
			}

			this._renderHeader();
		}

		_renderHeader() {
			this.headerContainer.replaceChildren();

			const hasTokens = !!this.lengthDisplay.textContent;
			const hasCache = !!this.cachedDisplay.textContent;

			if (!hasTokens) return;

			if (hasCache) {
				const gap = this.lengthBar ? '\u00A0\u00A0' : '\u00A0';
				this.headerDisplay.replaceChildren(
					this.lengthGroup,
					document.createTextNode(gap),
					this.cachedDisplay
				);
			} else {
				this.headerDisplay.replaceChildren(this.lengthGroup);
			}

			this.headerContainer.appendChild(this.headerDisplay);
		}

		setUsage(usage) {
			const clamp = (n) => Math.max(0, Math.min(100, n));
			const toWindow = (w, hours) => {
				if (!w || typeof w.utilization !== 'number') return null;
				const resetMs = w.resets_at ? Date.parse(w.resets_at) : null;
				return {
					pct: Math.round(w.utilization * 10) / 10,
					width: clamp(w.utilization),
					resetMs,
					startMs: resetMs ? resetMs - hours * 60 * 60 * 1000 : null
				};
			};
			const session = toWindow(usage?.five_hour, 5);
			const weekly = toWindow(usage?.seven_day, 24 * 7);

			// Fable cap (only alongside a weekly window).
			const f = usage?.fable;
			let fable = null;
			if (weekly && f && typeof f.utilization === 'number') {
				const width = clamp(f.utilization);
				// Color by claude.ai's severity when present; fall back to % thresholds.
				const sev = typeof f.severity === 'string' ? f.severity : null;
				let state;
				if (sev) {
					state = sev === 'normal' ? 'normal' : sev === 'warning' ? 'warn' : 'crit';
				} else {
					state = width >= 90 ? 'crit' : width >= 75 ? 'warn' : 'normal';
				}
				fable = { pct: Math.round(f.utilization * 10) / 10, width, name: f.display_name || 'Fable', state };
			}

			this.usage = { session, weekly, fable };
			this.refreshProgressChrome();
			this._activeView()?.render(this.usage);
		}

		tick() {
			// Cache countdown
			const now = Date.now();
			if (this.lastCachedUntilMs && this.lastCachedUntilMs > now) {
				const secondsLeft = Math.max(0, Math.ceil((this.lastCachedUntilMs - now) / 1000));
				if (this.cacheTimeSpan) {
					this.cacheTimeSpan.textContent = formatSeconds(secondsLeft);
				}
			} else if (this.lastCachedUntilMs && this.lastCachedUntilMs <= now) {
				this.lastCachedUntilMs = null;
				this.cacheTimeSpan = null;
				this.pendingCache = false;
				this.cachedDisplay.textContent = '';
				this._renderHeader();
			}

			// Reset countdowns + "now" markers
			this._activeView()?.render(this.usage);
		}
	}

	CC.ui = {
		CounterUI
	};
})();
