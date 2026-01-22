/**
 * components/diagnostics/index.js
 * Module wrapper that exposes diagnostics modal functions from the global attach
 * so ESM importers can use them even when the modal file is loaded as a non-module.
 */

export function openDiagnosticsModal(...args) {
	return (typeof window !== 'undefined' && window.openDiagnosticsModal) ? window.openDiagnosticsModal(...args) : null;
}

export function closeDiagnosticsModal(...args) {
	return (typeof window !== 'undefined' && window.closeDiagnosticsModal) ? window.closeDiagnosticsModal(...args) : null;
}

export default { openDiagnosticsModal, closeDiagnosticsModal };
