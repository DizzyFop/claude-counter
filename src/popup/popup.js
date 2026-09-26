(() => {
	'use strict';

	const CC = globalThis.ClaudeCounter;
	const api = globalThis.browser || globalThis.chrome;
	const styleInputs = document.querySelectorAll('input[name="usageStyle"]');
	const alwaysShowLabels = document.getElementById('alwaysShowLabels');

	document.getElementById('version').textContent = `Version ${api.runtime.getManifest().version}`;

	// "Always show usage text" only applies to the lines design.
	const reflectStyle = (style) => {
		alwaysShowLabels.disabled = style !== 'lines';
	};

	api.storage.local.get(CC.SETTINGS_DEFAULTS).then((settings) => {
		for (const input of styleInputs) input.checked = input.value === settings.usageStyle;
		alwaysShowLabels.checked = settings.alwaysShowLabels;
		reflectStyle(settings.usageStyle);
	});

	for (const input of styleInputs) {
		input.addEventListener('change', () => {
			reflectStyle(input.value);
			api.storage.local.set({ usageStyle: input.value });
		});
	}

	alwaysShowLabels.addEventListener('change', () => {
		api.storage.local.set({ alwaysShowLabels: alwaysShowLabels.checked });
	});
})();
