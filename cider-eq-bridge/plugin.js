const eventName = "equicord-cider:eq";
const cleanupKey = "__equicordEQBridgeCleanup";

function finite(value, min, max) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid EQ value");
    return Math.max(min, Math.min(max, value));
}

export default {
    name: "Equicord EQ Bridge",
    identifier: "local.aunight.equicord-eq-bridge",
    version: "1.0.0",
    author: "AuNight",
    description: "Applies local EQ commands from Equicord CiderControls.",
    pluginKitVersion: 4,
    setup() {
        window[cleanupKey]?.();
        const messages = window.__PLUGINSYS__.ExternalMessages;
        const listener = async event => {
            try {
                const patch = event.detail;
                if (!patch || typeof patch !== "object") return;
                const allowed = ["enabled", "reset", "band", "gain", "mix", "bass"];
                if (!Object.keys(patch).length || Object.keys(patch).some(key => !allowed.includes(key))) return;
                const cider = window.CiderApp;
                const existing = cider.config.getValue("audio.equalizer");
                const eq = { ...existing, gain: existing.gain.map(Number), frequencies: [...existing.frequencies], Q: [...existing.Q] };
                if (typeof patch.enabled === "boolean") eq.enabled = patch.enabled;
                if (patch.reset === true) {
                    eq.gain = Array(10).fill(0);
                    eq.frequencies = [32, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
                    eq.Q = Array(10).fill(Math.SQRT1_2);
                    eq.mix = 1;
                    eq.vibrantBass = 0;
                }
                if (patch.band !== undefined) {
                    if (!Number.isInteger(patch.band) || patch.band < 0 || patch.band > 9) return;
                    eq.gain[patch.band] = finite(patch.gain, -12, 12);
                }
                if (patch.mix !== undefined) eq.mix = finite(patch.mix, 0, 1);
                if (patch.bass !== undefined) eq.vibrantBass = finite(patch.bass, 0, 10);
                eq.userGenerated = true;
                eq.preset = "custom";
                cider.config.setValue("audio.equalizer", eq);
                if (window.CiderAudio._initComplete) window.CiderAudio.hierarchical_loading();
                else window.CiderAudio.init();
                await cider.config.saveConfig();
            } catch (error) { console.error("Equicord EQ Bridge could not apply EQ", error); }
        };
        messages.addEventListener(eventName, listener);
        window[cleanupKey] = () => messages.removeEventListener(eventName, listener);
    }
};
