/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { PluginNative } from "@utils/types";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, useEffect, useRef, useState } from "@webpack/common";

import type { EQPatch, Equalizer } from "./native";

const Native = VencordNative.pluginHelpers.CiderControls as PluginNative<typeof import("./native")>;

function EqualizerModal(props: RenderModalProps) {
    const [eq, setEQ] = useState<Equalizer | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("Loading Cider EQ…");
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        const backing = document.createElement("div");
        backing.className = "eq-cider-modal-sampling";
        backing.setAttribute("aria-hidden", "true");
        document.body.append(backing);
        void Native.equalizer().then(value => {
            if (alive.current) { setEQ(value); setMessage(value ? "" : "Could not read Cider EQ."); }
        }).catch(() => { if (alive.current) setMessage("Could not connect to Cider."); });
        return () => { alive.current = false; backing.remove(); };
    }, []);
    async function commit(patch: EQPatch) {
        setBusy(true);
        setMessage("");
        try {
            const result = await Native.setEqualizer(patch);
            const current = await Native.equalizer();
            if (alive.current) { setMessage(result.message); if (current) setEQ(current); }
        } catch { if (alive.current) setMessage("Could not apply EQ."); }
        finally { if (alive.current) setBusy(false); }
    }
    return <Modal {...props} size="lg" title="Cider Equalizer" subtitle="Adjust Cider audio from 32 Hz to 16 kHz.">
        <div className="eq-cider-equalizer">
            {eq && <>
                <div className="eq-cider-eq-toolbar">
                    <Button variant="secondary" disabled={busy} aria-pressed={eq.enabled} onClick={() => void commit({ enabled: !eq.enabled })}>{eq.enabled ? "EQ enabled" : "EQ disabled"}</Button>
                    <Button variant="secondary" disabled={busy} onClick={() => void commit({ reset: true })}>Reset</Button>
                </div>
                <div className="eq-cider-eq-bands">
                    {eq.gain.map((gain, band) => <label className="eq-cider-eq-band" key={band}>
                        <output>{gain.toFixed(1)}</output>
                        <input type="range" min="-12" max="12" step="0.1" value={gain} disabled={busy} aria-label={`${eq.frequencies[band]} Hz gain`} onChange={e => { const value = Number(e.currentTarget.value); setEQ({ ...eq, gain: eq.gain.map((g, i) => i === band ? value : g) }); }} onPointerUp={e => void commit({ band, gain: Number(e.currentTarget.value) })} onKeyUp={e => { if (["ArrowUp", "ArrowDown", "Home", "End", "ArrowLeft", "ArrowRight"].includes(e.key)) void commit({ band, gain: Number(e.currentTarget.value) }); }} />
                        <span>{eq.frequencies[band] >= 1000 ? `${eq.frequencies[band] / 1000}k` : eq.frequencies[band]}</span>
                    </label>)}
                </div>
                <div className="eq-cider-eq-extra">
                    <label>Vibrant Bass <output>{eq.vibrantBass.toFixed(1)}</output><input aria-label="Vibrant Bass" type="range" min="0" max="10" step="0.1" value={eq.vibrantBass} disabled={busy} onChange={e => setEQ({ ...eq, vibrantBass: Number(e.currentTarget.value) })} onPointerUp={e => void commit({ bass: Number(e.currentTarget.value) })} onKeyUp={e => { if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") void commit({ bass: Number(e.currentTarget.value) }); }} /></label>
                    <label>Mix <output>{Math.round(eq.mix * 100)}%</output><input aria-label="EQ mix" type="range" min="0" max="1" step="0.01" value={eq.mix} disabled={busy} onChange={e => setEQ({ ...eq, mix: Number(e.currentTarget.value) })} onPointerUp={e => void commit({ mix: Number(e.currentTarget.value) })} onKeyUp={e => { if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") void commit({ mix: Number(e.currentTarget.value) }); }} /></label>
                </div>
            </>}
            {message && <div role="status">{message}</div>}
        </div>
    </Modal>;
}

const SafeEqualizer = ErrorBoundary.wrap(EqualizerModal, { noop: false });
export function openEqualizer() { openModal(props => <SafeEqualizer {...props} />); }
