/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { EquicordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { ContextMenuApi, createRoot, Menu, useEffect, useRef, useState } from "@webpack/common";
import type { CSSProperties } from "react";
import type { Root } from "react-dom/client";

import { openEqualizer } from "./Equalizer";
import { Lyrics } from "./Lyrics";
import type { Action, Playback } from "./native";

const Native = VencordNative.pluginHelpers.CiderControls as PluginNative<typeof import("./native")>;
const logger = new Logger("CiderControls");
const settings = definePluginSettings({
    showOffline: {
        type: OptionType.BOOLEAN,
        description: "Show the player when Cider is closed.",
        default: false
    },
    showTranslation: {
        type: OptionType.BOOLEAN,
        description: "Show available English lyric translations.",
        default: true
    },
    showRomanization: {
        type: OptionType.BOOLEAN,
        description: "Show supplied or locally generated Japanese romanization.",
        default: true
    },
    lyricsExpanded: {
        type: OptionType.BOOLEAN,
        description: "Expand the player to show three synchronized lyric lines.",
        default: false
    }
});
const settingKeys: Array<"showOffline" | "lyricsExpanded" | "showTranslation" | "showRomanization"> = ["showOffline", "lyricsExpanded", "showTranslation", "showRomanization"];

function Icon({ name }: { name: "previous" | "next" | "play" | "pause" | "music" | "volume" | "eq" | "up" | "down"; }) {
    if (name === "up" || name === "down") return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d={name === "up" ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    if (name === "pause") return <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.3" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1.3" fill="currentColor" /></svg>;
    if (name === "eq") return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4v16M12 4v16M19 4v16M3 9h4M10 15h4M17 7h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
    const paths = {
        previous: "M6 5h2v14H6zM18 5v14l-9-7z",
        next: "M16 5h2v14h-2zM6 5l9 7-9 7z",
        play: "M8 6.2c0-.9 1-1.5 1.8-1l9.5 5.8c.7.5.7 1.5 0 2l-9.5 5.8c-.8.5-1.8-.1-1.8-1z",
        pause: "M6 5h4v14H6zm8 0h4v14h-4z",
        music: "M10 3v12.3a4 4 0 1 0 2 3.5V7l8-2V2z",
        volume: "M3 9v6h4l5 4V5L7 9zm12-1v8a5 5 0 0 0 0-8zm0-4v2a7 7 0 0 1 0 12v2a9 9 0 0 0 0-16z",
        eq: "M4 3h2v5H4zm0 9h2v9H4zm-2-4h6v4H2zm9-5h2v11h-2zm0 15h2v3h-2zm-2-4h6v4H9zm9-11h2v3h-2zm0 7h2v11h-2zm-2-4h6v4h-6z"
    };
    return <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" stroke="currentColor" strokeWidth="0.5" strokeLinejoin="round" d={paths[name]} /></svg>;
}

function time(value: number) {
    const seconds = Math.floor(Math.max(0, value));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function Player() {
    const { showOffline, lyricsExpanded, showTranslation, showRomanization } = settings.use(settingKeys);
    const [playback, setPlayback] = useState<Playback | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [seek, setSeek] = useState<number | null>(null);
    const [volume, setVolume] = useState<number | null>(null);
    const [failedArtwork, setFailedArtwork] = useState("");
    const refresh = useRef<() => Promise<void>>(async () => {});
    const commandPending = useRef(false);
    const alive = useRef(false);

    useEffect(() => {
        alive.current = true;
        let timer: ReturnType<typeof setTimeout>;
        let reading = false;
        const read = async () => {
            if (reading || !alive.current) return;
            reading = true;
            try {
                const state = await Native.status();
                if (alive.current) setPlayback(state);
            } catch {
                if (alive.current) setError("Cider connection temporarily interrupted.");
            } finally {
                reading = false;
            }
        };
        refresh.current = read;
        const poll = async () => {
            await read();
            if (alive.current) timer = setTimeout(poll, document.hidden ? 5000 : 1500);
        };
        void poll();
        return () => { alive.current = false; clearTimeout(timer); };
    }, []);

    async function control(action: Action, value?: number) {
        if (commandPending.current) return;
        commandPending.current = true;
        setBusy(true);
        setError("");
        try {
            const result = await Native.control(action, value);
            if (alive.current && !result.ok) setError(result.message);
            await refresh.current();
        } catch {
            if (alive.current) setError("Could not connect to Cider.");
        } finally {
            commandPending.current = false;
            if (alive.current) { setBusy(false); setSeek(null); setVolume(null); }
        }
    }

    async function changeMode(mode: string) {
        setBusy(true);
        try {
            const result = await Native.listeningMode(mode);
            if (alive.current) setError(result.message);
            await refresh.current();
        } catch { if (alive.current) setError("Could not change listening mode."); }
        finally { if (alive.current) setBusy(false); }
    }

    if (!playback?.connected && !showOffline) return null;
    const ready = Boolean(playback?.connected);
    const duration = playback?.duration ?? 0;
    const position = Math.min(duration, seek ?? playback?.position ?? 0);
    const level = volume ?? playback?.volume ?? 0.5;
    const playing = Boolean(playback?.playing);
    const title = playback?.title || "Cider";
    return (
        <section className="eq-cider-player" data-cider-version="1.5.1" aria-label="Cider music controls" aria-busy={busy}>
            <div className="eq-cider-row">
                <Button variant="none" className="eq-cider-artwork" aria-label={lyricsExpanded ? "Collapse lyrics" : "Expand lyrics"} title={lyricsExpanded ? "Collapse lyrics" : "Expand lyrics"} aria-expanded={lyricsExpanded} disabled={!ready} onClick={() => { settings.store.lyricsExpanded = !lyricsExpanded; }}>
                    {playback?.artwork && failedArtwork !== playback.artwork
                        ? <img src={playback.artwork} alt="" onError={() => setFailedArtwork(playback.artwork)} />
                        : <Icon name="music" />}
                    <span className="eq-cider-artwork-toggle" aria-hidden="true"><Icon name={lyricsExpanded ? "down" : "up"} /></span>
                </Button>
                <div className="eq-cider-info">
                    <div className="eq-cider-title" title={title}><span>{title}</span></div>
                    <div className="eq-cider-artist" title={playback?.artist}>{ready ? playback?.artist || "No track playing" : "Waiting for Cider"}</div>
                </div>
                <div className="eq-cider-transport">
                    <Button variant="none" size="iconOnly" className="eq-cider-button" aria-label="Previous track" title="Previous track" disabled={!ready || busy} onClick={() => void control("previous")}><Icon name="previous" /></Button>
                    <Button variant="none" size="iconOnly" className="eq-cider-button eq-cider-play" aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"} disabled={!ready || busy} onClick={() => void control("playpause")}><Icon name={playing ? "pause" : "play"} /></Button>
                    <Button variant="none" size="iconOnly" className="eq-cider-button" aria-label="Next track" title="Next track" disabled={!ready || busy} onClick={() => void control("next")}><Icon name="next" /></Button>
                </div>
            </div>
            {ready && <div className="eq-cider-sliders">
                <span className="eq-cider-time">{time(position)}</span>
                <input aria-label="Playback position" type="range" min="0" max={duration || 1} step="1" value={position} style={{ "--eq-cider-progress": `${duration ? position / duration * 100 : 0}%` } as CSSProperties} disabled={busy || !duration} onChange={e => setSeek(Number(e.currentTarget.value))} onPointerUp={e => void control("seek", Number(e.currentTarget.value))} onPointerCancel={() => setSeek(null)} onKeyUp={e => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) void control("seek", Number(e.currentTarget.value)); }} />
                <span className="eq-cider-time">{time(duration)}</span>
                <Icon name="volume" />
                <input className="eq-cider-volume" aria-label="Cider volume" type="range" min="0" max="1" step="0.01" value={level} style={{ "--eq-cider-progress": `${level * 100}%` } as CSSProperties} disabled={busy} onChange={e => setVolume(Number(e.currentTarget.value))} onPointerUp={e => void control("volume", Number(e.currentTarget.value))} onPointerCancel={() => setVolume(null)} onKeyUp={e => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) void control("volume", Number(e.currentTarget.value)); }} />
            </div>}
            {ready && <div className="eq-cider-options">
                <Button variant="none" size="iconOnly" className="eq-cider-option eq-cider-eq-button" aria-label="Open Cider Equalizer" title="Equalizer" onClick={openEqualizer}><Icon name="eq" /></Button>
                <Button variant="none" className="eq-cider-option eq-cider-lyric-toggle" aria-label="English translation" title="English translation" aria-pressed={showTranslation} onClick={() => { settings.store.showTranslation = !showTranslation; }}>T</Button>
                <Button variant="none" className="eq-cider-option eq-cider-lyric-toggle" aria-label="Romanization" title="Romanization" aria-pressed={showRomanization} onClick={() => { settings.store.showRomanization = !showRomanization; }}>R</Button>
                <div className="eq-cider-mode"><span>Mode</span><Button variant="none" className="eq-cider-mode-trigger" aria-label="Cider listening mode" aria-haspopup="menu" disabled={busy || !playback?.mode} onClick={event => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    Object.defineProperty(event, "clientX", { configurable: true, value: rect.right - 144 });
                    Object.defineProperty(event, "clientY", { configurable: true, value: rect.bottom + 6 });
                    Object.defineProperty(event, "pageX", { configurable: true, value: rect.right - 144 + window.scrollX });
                    Object.defineProperty(event, "pageY", { configurable: true, value: rect.bottom + 6 + window.scrollY });
                    ContextMenuApi.openContextMenu(event, () => <Menu.Menu navId="eq-cider-listening-mode" className="eq-cider-mode-menu" aria-label="Cider listening mode" onClose={ContextMenuApi.closeContextMenu}>
                        {[["off", "Off"], ["game", "Gaming"], ["antifatigue", "Anti-fatigue"], ["cozy", "Cozy"]].map(([mode, label]) => <Menu.MenuRadioItem key={mode} id={`eq-cider-mode-${mode}`} group="eq-cider-listening" label={label} checked={playback?.mode === mode} action={() => void changeMode(mode)} />)}
                    </Menu.Menu>);
                }}><span>{{ off: "Off", game: "Gaming", antifatigue: "Anti-fatigue", cozy: "Cozy" }[playback?.mode || "off"] || "Off"}</span><Icon name="down" /></Button></div>
            </div>}
            {ready && playback && <div className="eq-cider-lyrics-expander" data-expanded={lyricsExpanded}><div className="eq-cider-lyrics-clip"><Lyrics playback={playback} active={lyricsExpanded} showTranslation={showTranslation} showRomanization={showRomanization} /></div></div>}
            {(error || !ready) && <div className="eq-cider-status" role="status">{error || playback?.message || "Connecting to Cider…"}</div>}
        </section>
    );
}

const SafePlayer = ErrorBoundary.wrap(Player, { noop: true });
let root: Root | undefined;
let host: HTMLDivElement | undefined;
let observer: MutationObserver | undefined;
let sampling: HTMLDivElement | undefined;

function mount() {
    const panels = document.querySelector("section[class*='panels_'], .panels__5e434, .panels_c48ade");
    if (!panels) return;
    if (!sampling?.isConnected) {
        sampling = document.createElement("div");
        sampling.className = "eq-cider-sampling";
        sampling.setAttribute("aria-hidden", "true");
        document.body.append(sampling);
    }
    if (host?.parentElement === panels) {
        if (panels.firstElementChild !== host) panels.prepend(host);
        return;
    }
    root?.unmount();
    host?.remove();
    host = document.createElement("div");
    host.className = "eq-cider-host";
    panels.prepend(host);
    root = createRoot(host);
    root.render(<SafePlayer />);
}

export default definePlugin({
    name: "CiderControls",
    description: "Control Cider above your user panel, including while connected to voice.",
    authors: [EquicordDevs.nobody],
    tags: ["Media"],
    settings,
    enabledByDefault: true,
    start() {
        const update = () => {
            try { mount(); } catch (error) { logger.error("Unable to mount Cider player", error); }
        };
        observer = new MutationObserver(update);
        observer.observe(document.body, { childList: true, subtree: true });
        update();
    },
    stop() {
        observer?.disconnect();
        observer = undefined;
        root?.unmount();
        root = undefined;
        host?.remove();
        host = undefined;
        sampling?.remove();
        sampling = undefined;
    }
});
