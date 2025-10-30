// ui-widgets/src/hello-widget/index.jsx
import React, { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

/* ---- tiny hook: subscribe to window.openai globals ---- */
const SET_GLOBALS_EVENT_TYPE = "openai:set_globals";

function useOpenAiGlobal(key) {
    return useSyncExternalStore(
        (onChange) => {
            const handler = (ev) => {
                const v = ev?.detail?.globals?.[key];
                if (v !== undefined) onChange();
            };
            window.addEventListener(SET_GLOBALS_EVENT_TYPE, handler, { passive: true });
            return () => window.removeEventListener(SET_GLOBALS_EVENT_TYPE, handler);
        },
        () => (window.openai ? window.openai[key] : undefined),
        () => undefined
    );
}

function getInitialMessageFallback() {
    // Legacy fallbacks you already had
    const w = window;
    const sc =
        w.webplus?.getStructuredContent?.() ??
        w.webplus?.getInitialData?.()?.structuredContent ??
        w.oai?.structuredContent ??
        w.oai?.data ??
        {};
    return typeof sc.message === "string" ? sc.message : null;
}

function App() {
    // Read official globals
    const toolOutput = useOpenAiGlobal("toolOutput");
    const displayMode = useOpenAiGlobal("displayMode") ?? "inline";

    // Derive message from toolOutput first; otherwise fallback to legacy bridges
    const [msg, setMsg] = useState(() => {
        const m =
            (toolOutput && typeof toolOutput.message === "string" && toolOutput.message) ||
            getInitialMessageFallback() ||
            "Waiting for structuredContent…";
        return m;
    });

    // Keep msg in sync if host pushes new toolOutput later
    useEffect(() => {
        if (toolOutput && typeof toolOutput.message === "string") {
            setMsg(toolOutput.message);
        }
    }, [toolOutput]);

    // (Optional) still listen to postMessage events as a safety net
    useEffect(() => {
        const onMessage = (ev) => {
            const d = ev?.data;
            if (!d) return;
            if (d.type === "oai:structured-content" && d.payload?.message) {
                setMsg(d.payload.message);
            } else if (d.structuredContent?.message) {
                setMsg(d.structuredContent.message);
            } else if (typeof d?.message === "string") {
                setMsg(d.message);
            }
        };
        window.addEventListener("message", onMessage, { passive: true });
        return () => window.removeEventListener("message", onMessage);
    }, []);

    // (Nice-to-have) examples of the new API you can wire to buttons:
    async function goFullscreen() {
        await window.openai?.requestDisplayMode?.({ mode: "fullscreen" });
    }
    async function persistState() {
        await window.openai?.setWidgetState?.({ lastMessageAt: Date.now() });
    }
    async function refreshFromTool() {
        // Your server must define a tool name; this is just an example
        await window.openai?.callTool?.("hello-widget", { message: "Updated via callTool()" });
    }

    return (
        <div className="hello-widget">
            <div className="hello-title">Hello Widget ✅</div>
            <div className="hello-card">{msg}</div>
            <div className="hello-foot">displayMode: {displayMode}</div>

            {/* optional demo controls */}
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                <button onClick={goFullscreen}>Fullscreen</button>
                <button onClick={persistState}>Save widgetState</button>
                <button onClick={refreshFromTool}>callTool() update</button>
            </div>
        </div>
    );
}

const mount = document.getElementById("hello-widget-root");
if (mount) createRoot(mount).render(<App />);
