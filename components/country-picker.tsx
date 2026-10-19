"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Delegate } from "@/lib/domain";
import { searchDelegates, type OpportunityCounts, type OpportunityKind } from "@/lib/country-search";

/** Compact, local-only selection. Selecting never submits the surrounding queue form. */
export function CountryPicker({ label, delegates, value, onChange, counts, kind, disabled = false }: {
  label: string;
  delegates: Delegate[];
  value: string;
  onChange: (id: string) => void;
  counts: OpportunityCounts;
  kind: OpportunityKind;
  disabled?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);
  const [mostFirst, setMostFirst] = useState(false);
  const [above, setAbove] = useState(false);
  const [listHeight, setListHeight] = useState(240);
  // Live counts remain visible, but a background contribution must not move the option under the Chair.
  const [countsAtOpen, setCountsAtOpen] = useState<OpportunityCounts>({});
  const matches = searchDelegates(delegates, query, open ? countsAtOpen : counts, kind, mostFirst);
  const active = matches.find(d => d.id === highlight) ?? matches[0];
  const activeId = active?.id;
  const selected = delegates.find(d => d.id === value);
  const expanded = open && !disabled;
  useEffect(() => {
    if (!expanded || !activeId || !list.current) return;
    const option = document.getElementById(`${id}-${activeId}`)?.getBoundingClientRect();
    const box = list.current.getBoundingClientRect();
    if (option && option.top < box.top) list.current.scrollTop -= box.top - option.top;
    else if (option && option.bottom > box.bottom) list.current.scrollTop += option.bottom - box.bottom;
  }, [expanded, activeId, id]);
  function show() {
    if (disabled) return;
    if (!open) setCountsAtOpen(counts);
    const box = root.current?.getBoundingClientRect();
    if (box) {
      const headerBottom = Math.max(0, document.querySelector(".workspace-header")?.getBoundingClientRect().bottom ?? 0);
      const below = window.innerHeight - box.bottom - 8;
      const above = box.top - headerBottom - 8;
      const upwards = below < 320 && above > below;
      setAbove(upwards);
      // Reserve room for the small sort toolbar even when it wraps on phones.
      setListHeight(Math.max(48, Math.min(240, (upwards ? above : below) - 90)));
    }
    setOpen(true);
  }
  function choose(delegate: Delegate) {
    onChange(delegate.id);
    setOpen(false);
    setQuery("");
    setHighlight(null);
  }
  return <div className="country-picker" ref={root} onBlur={e => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setOpen(false); setQuery(""); setHighlight(null); }
  }} onKeyDown={e => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape" && expanded) {
      e.preventDefault(); e.stopPropagation(); input.current?.focus(); setOpen(false); setQuery(""); setHighlight(null);
    }
  }}>
    <label htmlFor={id}>{label}</label>
    <input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={expanded}
      aria-controls={expanded ? `${id}-list` : undefined} aria-activedescendant={expanded && active ? `${id}-${active.id}` : undefined}
      aria-describedby={`${id}-hint`} autoComplete="off" disabled={disabled}
      placeholder={delegates.length ? "Search country…" : "No eligible delegates"}
      value={expanded ? query : selected ? `${selected.flag} ${selected.country}` : ""}
      onFocus={show} onClick={show}
      onChange={e => { setQuery(e.target.value); setHighlight(null); show(); }}
      onKeyDown={e => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (!expanded && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key.length === 1 || e.key === "Backspace" || e.key === "Delete")) {
          // After Enter the input still has focus. A new query replaces the displayed selection, not its suffix.
          e.preventDefault(); setQuery(e.key.length === 1 ? e.key : ""); setHighlight(null); show();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (!expanded) { show(); setHighlight(null); return; }
          const at = matches.findIndex(d => d.id === active?.id);
          const next = (at + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
          setHighlight(matches[next]?.id ?? null);
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (!expanded) show(); else if (active) choose(active);
        }
      }} />
    <span id={`${id}-hint`} className="sr-only">Type a country. Use arrows and Enter to select; use the separate button to add it.</span>
    {expanded && <div className={`country-popup${above ? " above" : ""}`}>
      <div className="country-sort"><span>This session · {kind === "pois" ? "POIs" : "speeches"}</span><button type="button" onMouseDown={e => e.preventDefault()}
        aria-label={`Sort ${label.toLowerCase()}: ${mostFirst ? "most" : "fewest"} ${kind} first`}
        onClick={() => { setHighlight(active?.id ?? null); setMostFirst(!mostFirst); }}>{mostFirst ? "Most first" : "Fewest first"}</button></div>
      <ul ref={list} id={`${id}-list`} role="listbox" aria-label={label} style={{ maxHeight: listHeight }}>
        {matches.map(d => <li key={d.id} id={`${id}-${d.id}`} role="option" aria-selected={d.id === value}
          className={active?.id === d.id ? "highlighted" : ""}
          onMouseDown={e => e.preventDefault()} onClick={() => choose(d)}>
          <span><span aria-hidden="true">{d.flag}</span> {d.country}</span>
          <small>{counts[d.id]?.speeches ?? 0} speeches · {counts[d.id]?.pois ?? 0} POIs</small>
        </li>)}
      </ul>
      {!matches.length && <p role="status">No matching eligible countries.</p>}
    </div>}
  </div>;
}
