import React, {
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

/* -----------------------------
   Host globals (window.openai.*)
------------------------------ */
const SET_GLOBALS_EVENT_TYPE = "openai:set_globals";
function useOpenAiGlobal(key) {
    return useSyncExternalStore(
        (onChange) => {
            const h = (ev) => {
                if (ev?.detail?.globals?.[key] !== undefined) onChange();
            };
            window.addEventListener(SET_GLOBALS_EVENT_TYPE, h, { passive: true });
            return () => window.removeEventListener(SET_GLOBALS_EVENT_TYPE, h);
        },
        () => (window.openai ? window.openai[key] : undefined),
        () => undefined
    );
}

/* -----------------------------------------
   Capabilities + bridges
------------------------------------------ */
function hostCaps() {
    return {
        hasAppend: !!window.openai?.appendUserMessage,
        hasSend: !!window.openai?.sendMessage,
        hasCallTool: !!window.openai?.callTool || !!window.openai?.invokeTool,
    };
}

async function sendChatMessage(text) {
    try {
        if (window.openai?.appendUserMessage) {
            return await window.openai.appendUserMessage(text);
        }
    } catch (e) {
        console.warn("appendUserMessage failed", e);
    }
    try {
        if (window.openai?.sendMessage) {
            return await window.openai.sendMessage({ role: "user", content: text });
        }
    } catch (e) {
        console.warn("sendMessage failed", e);
    }
    try {
        // Optional dev/event fallback
        window.dispatchEvent(
            new CustomEvent("openai:append_user_message", { detail: { text } })
        );
        return true;
    } catch { }
    try {
        window.parent?.postMessage({ type: "openai:append_user_message", text }, "*");
        return true;
    } catch { }
    console.log("[fallback] would send user message:", text);
    return false;
}

async function callTool(name, args) {
    try {
        if (window.openai?.callTool) {
            return await window.openai.callTool({ name, arguments: args });
        }
        if (window.openai?.invokeTool) {
            // some hosts expose invokeTool(name, args)
            return await window.openai.invokeTool(name, args);
        }
    } catch (e) {
        console.warn("callTool failed", e);
    }
    return null;
}

/* -----------------------------------------
   Helpers: SRR extraction + hotel coercion
------------------------------------------ */
function extractSrr(raw) {
    const candidates = [
        raw?.search_result_id,
        raw?.srr,
        raw?.hotel?.search_result_id,
        raw?.hotel?.srr,
        typeof raw?.id === "string" && raw.id.startsWith("srr_") ? raw.id : null,
        typeof raw?.hotel?.id === "string" && raw.hotel.id.startsWith("srr_")
            ? raw.hotel.id
            : null,
    ].filter(Boolean);
    const v = candidates[0];
    return typeof v === "string" && v.startsWith("srr_") ? v : "";
}

function mapHotels(output) {
    const src =
        (output && (output.hotels || output.results || output.stays)) ||
        (Array.isArray(output?.data) ? output.data : []);
    if (!Array.isArray(src)) return [];

    return src.map((it, i) => {
        const hotel = it.hotel || it;
        const price =
            typeof it.price === "string"
                ? it.price
                : it.price && it.price.amount && it.price.currency
                    ? `${it.price.currency} ${Number(it.price.amount).toFixed(2)}`
                    : "";

        const photo =
            it.photo ||
            it.image ||
            (Array.isArray(it.images) ? it.images[0]?.url || it.images[0] : "") ||
            (Array.isArray(hotel.photos) ? hotel.photos[0]?.url : "") ||
            "";

        const srr = extractSrr(it);
        const city =
            hotel.city ||
            it.city ||
            hotel?.location?.address?.city_name ||
            hotel?.location?.address?.line_one ||
            it.location ||
            "";

        return {
            id: hotel.id || it.id || `hotel_${i}`,
            name: hotel.name || it.name || "Hotel",
            city,
            rating:
                hotel.rating ??
                it.rating ??
                hotel.star_rating ??
                it.star_rating ??
                null,
            price,
            photo,
            amenities: it.amenities || hotel.amenities || [],
            highlight: !!it.highlight,
            srr,
            search_result_id: srr,
        };
    });
}

/* --------------- UI bits --------------- */
function StarBadge({ value }) {
    if (!value) return null;
    return (
        <span className="hc-badge" title={`${value} star rating`}>
            <span className="hc-star" aria-hidden="true">★</span>
            <span>{value}</span>
        </span>
    );
}

function AmenityChips({ list }) {
    if (!list?.length) return null;
    const shown = list.slice(0, 2);
    const rest = Math.max(0, list.length - shown.length);
    return (
        <div className="hc-chips">
            {shown.map((a, i) => (
                <span key={i} className="hc-chip">{String(a)}</span>
            ))}
            {rest > 0 && <span className="hc-chip hc-chip--more">+{rest} more</span>}
        </div>
    );
}

function HotelCard({ h, onSelect }) {
    const disabled = !h.srr && !h.search_result_id;
    return (
        <button
            className={`hc-card ${h.highlight ? "hc-card--highlight" : ""} ${disabled ? "hc-card--disabled" : ""}`}
            onClick={() => !disabled && onSelect(h)}
            aria-disabled={disabled}
            title={disabled ? "No room rates available for this result" : h.name}
            type="button"
        >
            {h.photo ? (
                <img className="hc-img" src={h.photo} alt="" referrerPolicy="no-referrer" />
            ) : (
                <div className="hc-img hc-img--placeholder" aria-hidden="true" />
            )}
            <div className="hc-gradient" aria-hidden="true" />
            <div className="hc-inset">
                <div className="hc-top">
                    <div className="hc-titlewrap">
                        <div className="hc-title" title={h.name}>{h.name}</div>
                        <div className="hc-subtitle">{h.city}</div>
                    </div>
                    <StarBadge value={h.rating} />
                </div>
                <div className="hc-bottom">
                    <div className="hc-price">{h.price || "—"}</div>
                    <AmenityChips list={h.amenities} />
                </div>
            </div>
        </button>
    );
}

/* ----------- App ----------- */
function App() {
    const toolOutput = useOpenAiGlobal("toolOutput");
    const hotels = useMemo(() => mapHotels(toolOutput || {}), [toolOutput]);

    const railRef = useRef(null);
    const [canLeft, setCanLeft] = useState(false);
    const [canRight, setCanRight] = useState(false);

    const [picked, setPicked] = useState(null); // preview bubble
    const [sending, setSending] = useState(false);
    const [sentOnce, setSentOnce] = useState(false);
    const [lastHash, setLastHash] = useState("");

    const caps = hostCaps();

    const updateNavState = () => {
        const el = railRef.current;
        if (!el) return;
        const maxLeft = el.scrollWidth - el.clientWidth;
        setCanLeft(el.scrollLeft > 0);
        setCanRight(el.scrollLeft < maxLeft - 1);
    };

    useEffect(() => {
        updateNavState();
        const el = railRef.current;
        if (!el) return;
        const onScroll = () => updateNavState();
        const onResize = () => updateNavState();
        el.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onResize, { passive: true });
        return () => {
            el.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onResize);
        };
    }, [hotels.length]);

    const scrollByOneCard = (dir) => {
        const el = railRef.current;
        if (!el) return;
        const card = el.querySelector(".hc-card");
        const styles = getComputedStyle(el);
        const gap = parseFloat(styles.columnGap || styles.gap || "0") || 0;
        const cardWidth = card ? card.getBoundingClientRect().width : el.clientWidth * 0.8;
        el.scrollBy({ left: (cardWidth + gap) * dir, behavior: "smooth" });
    };

    const buildSelectionMessage = (h, srr) => {
        return [
            "I want to stay here — please show me room options and availability.",
            "",
            `Hotel Name: ${h.name}`,
            `Location: ${h.city || "-"}`,
            `Rating: ${h.rating ?? "-"} stars`,
            `Price: ${h.price || "-"}`,
            `search_result_id: ${srr || "-"}`,
            h.amenities?.length ? `Amenities: ${h.amenities.join(", ")}` : null,
            "",
            // Hint that lets your router auto-pick the tool if you prefer message flow
            `Call tool fetch_hotel_rates_ui with: ${JSON.stringify(
                {
                    search_result_id: srr || "",
                    hotel_name: h.name,
                    location: h.city || "",
                    message: "Please fetch and display room rates for this hotel selection.",
                },
                null,
                2
            )}`,
        ]
            .filter(Boolean)
            .join("\n");
    };

    async function onSelectHotel(h) {
        const srr = h.search_result_id || h.srr || "";

        // show preview bubble either way
        setPicked({
            hotel_name: h.name,
            location: h.city,
            rating: h.rating,
            price: h.price,
            amenities: h.amenities || [],
            srr,
        });

        // dedupe against fast double-clicks
        const text = buildSelectionMessage(h, srr);
        const hash = `${h.id}::${srr}::${text.length}`;
        if (hash === lastHash || sending) return;

        setSending(true);
        try {
            // Preferred: send a *user* message (if supported in this host)
            if (caps.hasAppend || caps.hasSend) {
                await sendChatMessage(text);
                setSentOnce(true);
                setLastHash(hash);
                return;
            }
            // Fallback: directly call the room-rates tool so UX still works
            if (caps.hasCallTool && srr) {
                await callTool("fetch_hotel_rates_ui", {
                    search_result_id: srr,
                    hotel_name: h.name,
                    location: h.city || "",
                    message: "Please fetch and display room rates for this hotel selection.",
                });
                setSentOnce(true); // reflect that an action happened
                setLastHash(hash);
                return;
            }
            // If neither is available, we can only preview
            console.warn("No host bridge available: cannot send message or call tool.");
        } finally {
            setSending(false);
        }
    }

    return (
        <div className="hc-wrap">
            <div className="hc-rail">
                <button
                    className="hc-nav hc-nav--left"
                    aria-label="Scroll left"
                    onClick={() => scrollByOneCard(-1)}
                    disabled={!canLeft}
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M15.5 19 8.5 12l7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </button>

                <div ref={railRef} className="hc-scroll" aria-label="Hotel results">
                    {hotels.map((h) => (
                        <HotelCard key={`${h.id}`} h={h} onSelect={onSelectHotel} />
                    ))}
                </div>

                <button
                    className="hc-nav hc-nav--right"
                    aria-label="Scroll right"
                    onClick={() => scrollByOneCard(1)}
                    disabled={!canRight}
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M8.5 5 15.5 12l-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </button>
            </div>

            {!hotels.length && <div className="hc-empty">Waiting for hotel results…</div>}

            {picked && (
                <div className={`hc-bubble ${sending ? "is-sending" : ""} ${sentOnce ? "is-sent" : ""}`}>
                    <div>I want to stay here — please show me room options and availability.</div>
                    <div><b>Hotel Name:</b> {picked.hotel_name}</div>
                    <div><b>Location:</b> {picked.location}</div>
                    <div><b>Rating:</b> {picked.rating ?? "-"} stars</div>
                    <div><b>Price:</b> {picked.price || "-"}</div>
                    {picked.amenities?.length ? (
                        <div><b>Amenities:</b> {picked.amenities.join(", ")}</div>
                    ) : null}
                    <div><b>search_result_id:</b> {picked.srr || "—"}</div>
                    <div className="hc-bubble-cta">
                        {sending ? "Sending…" : sentOnce ? "Sent ✓" : (hostCaps().hasAppend || hostCaps().hasSend) ? "Will send as chat message" : hostCaps().hasCallTool ? "Calling tool directly" : "Preview only"}
                    </div>
                </div>
            )}

            {/* Diagnostics badge (remove in prod) */}
            <div
                style={{
                    position: "absolute",
                    bottom: 8,
                    right: 8,
                    fontSize: 12,
                    fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif",
                    background: "rgba(0,0,0,.05)",
                    padding: "4px 8px",
                    borderRadius: 8,
                }}
                aria-hidden="true"
            >
                caps: {caps.hasAppend ? "appendUserMessage " : ""}
                {caps.hasSend ? "sendMessage " : ""}
                {caps.hasCallTool ? "callTool" : ""}
                {!caps.hasAppend && !caps.hasSend && !caps.hasCallTool ? "none" : ""}
            </div>
        </div>
    );
}

const mount = document.getElementById("hotel-card-root");
if (mount) createRoot(mount).render(<App />);
