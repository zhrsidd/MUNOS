"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent, KeyboardEvent, PointerEvent, RefObject } from "react";
import type { Role } from "@/lib/domain";
import { useConference } from "@/lib/context";
import { repository } from "@/lib/repository";
import { felixContext, type FelixContext } from "@/lib/felix/context";
import { buildReminders } from "@/lib/felix/reminders";
import { answerQuestion } from "@/lib/felix/answer";
import { InboxStore, isNewSince, markPopped, markRead, mergeInbox, nextPopup, unreadCount } from "@/lib/felix/inbox";
import { MAX_MESSAGES, MOTION_KEY, felixStorageKeys, parseMotionPreference, parseStoredChat, type StoredMessage } from "@/lib/felix/storage";
import { FELIX_FRAMES, FelixMotion, felixFrameSrc, felixFrameSrcSet } from "@/lib/felix/motion";
import { useClock } from "./operations/photo-reminders";

const roleNames: Record<Role, string> = { chair: "Chair", approval: "Approval Panel", logistics: "Admins", admin: "Executive" };
const suggestions: Record<Role, string[]> = {
  chair: ["What should I do next?", "How do I give speech points?", "A Google Doc won’t open"],
  approval: ["What should I do next?", "How do I request changes?", "What does “Saved on this device” mean?"],
  logistics: ["What should I do next?", "How do I mark a job printed?", "What does “Saved on this device” mean?"],
  admin: ["What should I do next?", "How do I rotate an access code?", "Where is resolution status?"],
};
const qatarTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Qatar" });

function browserStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
function readStorage(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* Felix keeps working for this page without storage. */ }
}

const reducedQuery = "(prefers-reduced-motion: reduce)";
const subscribeReduced = (listener: () => void) => {
  const media = window.matchMedia(reducedQuery);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
};
const useSystemReducedMotion = () => useSyncExternalStore(subscribeReduced, () => window.matchMedia(reducedQuery).matches, () => false);

/**
 * Wires the expression controller to the browser: reduced motion, hidden tab, offscreen launcher and the person's
 * own switch all hold Felix still. Frames are fetched only after the launcher mounts, and only while movement is
 * allowed; if any frame fails to load Felix simply stays on the static idle face.
 */
function useFelixMotion(launcher: RefObject<HTMLButtonElement | null>, enabled: boolean, reduced: boolean) {
  const [motion] = useState(() => new FelixMotion());
  const frames = useRef<"none" | "loading" | "ready">("none");
  useEffect(() => { motion.setConditions({ enabled, reduced }); }, [motion, enabled, reduced]);
  useEffect(() => {
    if (!enabled || reduced || frames.current !== "none") return;
    frames.current = "loading";
    let live = true;
    const size = window.devicePixelRatio > 2 ? 144 : 96;
    Promise.all(FELIX_FRAMES.map(frame => { const image = new Image(); image.src = felixFrameSrc(frame, size); return image.decode(); })).then(
      () => { frames.current = "ready"; if (live) motion.setConditions({ ready: true }); },
      () => { frames.current = "ready"; },
    );
    return () => { live = false; if (frames.current === "loading") frames.current = "none"; };
  }, [motion, enabled, reduced]);
  useEffect(() => {
    const sync = () => motion.setConditions({ hidden: document.hidden });
    motion.start();
    sync();
    document.addEventListener("visibilitychange", sync);
    const target = launcher.current;
    const observer = target && "IntersectionObserver" in window ? new IntersectionObserver(entries => motion.setConditions({ offscreen: !entries[entries.length - 1].isIntersecting })) : null;
    if (target) observer?.observe(target);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      observer?.disconnect();
      motion.destroy();
    };
  }, [motion, launcher]);
  return motion;
}

/** Decorative face: the button or panel around it carries the accessible name, so the image itself is silent. */
function FelixFace({ motion, size, onFail }: { motion: FelixMotion; size: 48 | 32; onFail?: () => void }) {
  const frame = useSyncExternalStore(motion.subscribe, motion.getFrame, () => "idle" as const);
  const petting = useSyncExternalStore(motion.subscribe, () => motion.getState() === "petting", () => false);
  return (
    // A plain <img>: frames swap by src and must work offline from the service worker, without the image optimiser.
    // eslint-disable-next-line @next/next/no-img-element
    <img className={`felix-face${petting ? " is-petting" : ""}`} src={felixFrameSrc(frame)} srcSet={felixFrameSrcSet(frame)} width={size} height={size} alt="" draggable={false} data-frame={frame} onError={onFail} />
  );
}

export function FelixHelper({ role, committeeId, committeeCode, sessionName }: { role: Role; committeeId?: string; committeeCode?: string; sessionName?: string }) {
  const { data } = useConference();
  const keys = felixStorageKeys(role, committeeId);
  const panelId = useId(), titleId = useId(), inputId = useId(), unreadId = useId(), inboxTitleId = useId();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inboxHeadingRef = useRef<HTMLHeadingElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"ask" | "inbox">("ask");
  const [input, setInput] = useState("");
  // Felix mounts only after the conference data has loaded on the client, so browser storage is readable here.
  const [messages, setMessages] = useState<StoredMessage[]>(() => parseStoredChat(readStorage(keys.chat), role));
  const [store] = useState(() => new InboxStore(keys.inbox, role, browserStorage()));
  const inbox = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  // When the Inbox view was opened in this visit: entries first shown since then are labelled New.
  const [inboxOpenedAt, setInboxOpenedAt] = useState<string | null>(null);
  const [motionOn, setMotionOn] = useState(() => parseMotionPreference(readStorage(MOTION_KEY)));
  const systemReduced = useSystemReducedMotion();
  const motion = useFelixMotion(launcherRef, motionOn, systemReduced);

  // The same health store the sync strip reads, and the photo clock the Chair banner uses: no extra requests.
  const health = useSyncExternalStore(repository.subscribe, repository.getHealth, repository.getHealth);
  const now = useClock(role === "chair" ? 30_000 : 3_600_000);
  const ctx = useMemo<FelixContext>(() => ({ ...felixContext(data, role, committeeId, now), health }), [data, role, committeeId, now, health]);
  const reminders = useMemo(() => buildReminders(ctx), [ctx]);
  const inboxVisible = open && view === "inbox";

  // Bring the inbox up to date whenever the reminders change; while the Inbox is on screen, arrivals are shown, so read.
  useEffect(() => { store.update(entries => mergeInbox(entries, reminders, new Date().toISOString())); }, [store, reminders]);
  useEffect(() => { if (inboxVisible) store.update(entries => markRead(entries, new Date().toISOString())); }, [store, inboxVisible, inbox]);
  useEffect(() => { writeStorage(keys.chat, JSON.stringify(messages.slice(-MAX_MESSAGES))); }, [messages, keys.chat]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [messages, open, view]);
  // Focus moves into Felix only when the person explicitly opened it.
  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    (view === "inbox" ? inboxHeadingRef.current : inputRef.current)?.focus();
  }, [open, view]);

  const showInbox = useCallback(() => {
    const at = new Date().toISOString();
    setInboxOpenedAt(at);
    store.update(entries => markRead(entries, at));
    setView("inbox");
  }, [store]);
  function openPanel(target: "ask" | "inbox") {
    focusOnOpen.current = true;
    if (target === "inbox") showInbox(); else setView("ask");
    setOpen(true);
  }
  function close(returnFocus: boolean) {
    setOpen(false);
    setInboxOpenedAt(null);
    if (returnFocus) launcherRef.current?.focus();
  }
  function dismissPopup(keys: string[]) {
    store.update(entries => markPopped(entries, keys));
    // The popup (and the focused control in it) disappears: put focus back on the launcher, never on the page body.
    if (document.activeElement?.closest(".felix-popup")) launcherRef.current?.focus();
  }
  function onPanelKey(event: KeyboardEvent) {
    if (event.key === "Escape") { event.stopPropagation(); close(true); }
  }

  function ask(text: string) {
    const clean = text.trim();
    if (!clean) return;
    motion.stopTyping();
    // Replies are computed locally and shown at once: no artificial delay, no simulated typing.
    const reply = answerQuestion(clean, ctx, reminders);
    setMessages(old => {
      const id = old.reduce((highest, message) => Math.max(highest, message.id + 1), 0);
      return [...old, { id, from: "you" as const, text: clean }, { id: id + 1, from: "felix" as const, text: reply.text, ...(reply.href ? { href: reply.href, linkLabel: reply.linkLabel ?? "Open" } : {}) }].slice(-MAX_MESSAGES);
    });
    setInput("");
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); ask(input); }
  function setMotion(on: boolean) { setMotionOn(on); writeStorage(MOTION_KEY, on ? "on" : "off"); }

  const unread = unreadCount(inbox);
  const popup = !open ? nextPopup(inbox) : null;
  const contextLine = role === "chair" ? `${committeeCode ?? "Your committee"}${sessionName ? ` · ${sessionName}` : ""}` : `${roleNames[role]} workspace`;
  const pet = (event: PointerEvent<HTMLButtonElement>) => { if (event.pointerType !== "touch") motion.pet(); };
  const failFrames = () => motion.setConditions({ ready: false });

  return (
    <div className="felix">
      <div className="felix-popup-region" role="status" aria-live="polite">
        {popup && (
          <div className={`felix-popup ${popup.entry.priority}`} onKeyDown={event => { if (event.key === "Escape") dismissPopup(popup.keys); }}>
            <p>
              <span className="felix-popup-kind">{popup.entry.priority === "urgent" ? "Urgent" : "Felix"}</span> {popup.entry.short}
              {popup.more > 0 && <small> +{popup.more} more in the Inbox</small>}
            </p>
            <div className="felix-popup-actions">
              <button type="button" className="text-button" onClick={() => openPanel("inbox")}>Open Inbox</button>
              <button type="button" className="felix-icon-button" aria-label="Dismiss notice" onClick={() => dismissPopup(popup.keys)}>×</button>
            </div>
          </div>
        )}
      </div>
      {open && (
        <section id={panelId} className="felix-panel" role="dialog" aria-modal="false" aria-labelledby={titleId} onKeyDown={onPanelKey}>
          <header className="felix-head">
            <span className="felix-avatar" aria-hidden="true"><FelixFace motion={motion} size={32} onFail={failFrames} /></span>
            <div>
              <h2 id={titleId}>Felix</h2>
              <small>{contextLine}</small>
            </div>
            <button type="button" className="felix-icon-button" aria-label="Close Felix panel" onClick={() => close(true)}>×</button>
          </header>
          <div className="felix-views" role="group" aria-label="Felix views">
            <button type="button" aria-pressed={view === "ask"} onClick={() => setView("ask")}>Ask</button>
            <button type="button" aria-pressed={view === "inbox"} onClick={showInbox}>
              Inbox{unread > 0 && view !== "inbox" ? ` · ${unread} new` : ""}
            </button>
          </div>
          {view === "ask" ? (
            <>
              <div className="felix-log" ref={logRef} role="log" aria-live="polite" aria-label="Conversation with Felix">
                <p className="felix-message felix-from-felix">
                  Hello, I’m Felix. Ask me what to do next, how something works in the {roleNames[role]} workspace, or what to do when something goes wrong. I follow fixed rules, read only what this page has loaded and never change anything for you.
                </p>
                {messages.map(message => (
                  <div key={message.id} className={`felix-message ${message.from === "you" ? "felix-from-you" : "felix-from-felix"}`}>
                    <span className="sr-only">{message.from === "you" ? "You: " : "Felix: "}</span>
                    {message.text}
                    {message.href && <Link href={message.href} onClick={() => close(false)}>{message.linkLabel} →</Link>}
                  </div>
                ))}
                {!messages.length && (
                  <div className="felix-suggestions">
                    {suggestions[role].map(item => <button type="button" key={item} onClick={() => ask(item)}>{item}</button>)}
                  </div>
                )}
              </div>
              <form className="felix-composer" onSubmit={submit}>
                <label className="sr-only" htmlFor={inputId}>Ask Felix a question</label>
                <input id={inputId} ref={inputRef} value={input} autoComplete="off" maxLength={400} placeholder="Ask a question…"
                  onChange={event => { setInput(event.target.value); motion.typing(); }} onBlur={() => motion.stopTyping()} />
                <button type="submit" className="primary" disabled={!input.trim()}>Send</button>
              </form>
            </>
          ) : (
            <section className="felix-inbox" aria-labelledby={inboxTitleId}>
              <h3 id={inboxTitleId} ref={inboxHeadingRef} tabIndex={-1}>Inbox</h3>
              {inbox.length ? (
                <ul>
                  {inbox.map(entry => (
                    <li key={entry.key} className={entry.active ? "" : "inactive"}>
                      <p className="felix-inbox-meta">
                        {isNewSince(entry, inboxOpenedAt) && <span className="felix-new">New</span>}
                        <span>{entry.priority === "urgent" ? "Urgent" : "Needs action"} · {qatarTime(entry.at)}</span>
                        {!entry.active && <span>· No longer current</span>}
                      </p>
                      <p>{entry.text}</p>
                      {entry.active && entry.href && <Link href={entry.href} onClick={() => close(false)}>{entry.linkLabel} →</Link>}
                    </li>
                  ))}
                </ul>
              ) : <p className="felix-empty">No notices yet. Reminders that need you will appear here and stay after any popup closes.</p>}
              <p className="felix-fine">Kept in this browser only. “New” marks notices you had not opened here before.</p>
            </section>
          )}
          <footer className="felix-foot">
            <p>Still stuck? Message the Executive.</p>
            <label className="felix-motion-toggle">
              <input type="checkbox" checked={motionOn && !systemReduced} disabled={systemReduced} onChange={event => setMotion(event.target.checked)} />
              Animate Felix
            </label>
            {systemReduced && <small>Still because this device asks for reduced motion.</small>}
          </footer>
        </section>
      )}
      <button
        ref={launcherRef}
        type="button"
        className="felix-launcher"
        aria-label={open ? "Close Felix" : "Open Felix"}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-describedby={unread > 0 ? unreadId : undefined}
        onClick={() => (open ? close(false) : openPanel("ask"))}
        onKeyDown={event => { if (event.key === "Escape" && open) close(true); }}
        onPointerEnter={pet}
        onPointerMove={event => { if (Math.abs(event.movementX) + Math.abs(event.movementY) > 2) pet(event); }}
        onFocus={event => { if (event.currentTarget.matches(":focus-visible")) motion.pet(); }}
      >
        <FelixFace motion={motion} size={48} onFail={failFrames} />
        {unread > 0 && !open && <span className="felix-badge" aria-hidden="true">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {unread > 0 && <span id={unreadId} className="sr-only">{unread} unread {unread === 1 ? "notice" : "notices"} in Felix’s Inbox</span>}
    </div>
  );
}
