"use client";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { activeEntry, type NavItem } from "@/lib/navigation";
import type { Role } from "@/lib/domain";
import { indicatorPlacement, indicatorTransform, sameRow, type Placement } from "@/lib/ui/tab-indicator";

// The route can remount this component; remember where the indicator was so it still slides from the old tab.
let lastPlacement: { role: Role; placement: Placement; at: number } | null = null;
const REMEMBER_MS = 1500;
const prefersReducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * One underline that slides to the active tab (pattern adapted from Watermelon "Continuous Tabs", MIT, see
 * docs/WATERMELON_LICENSE.txt). It is positioned by measuring the active tab and moved with a transform only. It is
 * an enhancement: until it has measured successfully (and whenever measuring fails) each tab draws its own underline.
 */
function useTabIndicator(role: Role, activeKey: string, countKey: string) {
  const nav = useRef<HTMLElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const placed = useRef<Placement | null>(null);
  const place = useCallback((animate: boolean) => {
    const root = nav.current;
    const el = bar.current;
    if (!root || !el) return;
    try {
      const row = el.parentElement;
      const active = row?.querySelector<HTMLElement>(".tab.active");
      const next = row && active ? indicatorPlacement(row.getBoundingClientRect(), active.getBoundingClientRect()) : null;
      if (!next) {
        delete root.dataset.indicator;
        placed.current = null;
        return;
      }
      const current = placed.current;
      if (current && current.x === next.x && current.y === next.y && current.w === next.w) return;
      const remembered = lastPlacement && lastPlacement.role === role && performance.now() - lastPlacement.at < REMEMBER_MS ? lastPlacement.placement : null;
      const from = current ?? remembered;
      root.dataset.indicator = "on";
      if (animate && from && sameRow(from, next) && !prefersReducedMotion()) {
        if (!current) {
          el.dataset.animate = "false";
          el.style.transform = indicatorTransform(from);
          el.getBoundingClientRect(); // commit the starting position so the move below is a transition
        }
        el.dataset.animate = "true";
      } else {
        el.dataset.animate = "false";
      }
      el.style.transform = indicatorTransform(next);
      placed.current = next;
      lastPlacement = { role, placement: next, at: performance.now() };
    } catch {
      delete root.dataset.indicator;
      placed.current = null;
    }
  }, [role]);
  useLayoutEffect(() => {
    place(true);
  }, [place, activeKey, countKey]);
  useEffect(() => {
    const row = bar.current?.parentElement;
    if (!row) return;
    let live = true;
    const remeasure = () => place(false);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(remeasure);
    observer?.observe(row);
    row.querySelectorAll(".tab").forEach((tab) => observer?.observe(tab));
    window.addEventListener("resize", remeasure);
    void document.fonts?.ready.then(() => live && remeasure());
    return () => {
      live = false;
      observer?.disconnect();
      window.removeEventListener("resize", remeasure);
    };
  }, [place, activeKey, countKey]);
  return { nav, bar };
}

/** A disclosure menu: Escape and outside clicks close it, focus returns to its button. */
function TabMenu({ item, role, section, active }: { item: NavItem; role: Role; section: string; active: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div className="tab-menu" ref={root}>
      <button ref={button} className={`tab${active ? " active" : ""}`} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>
        {item.label}
        <span aria-hidden="true" className="tab-caret" />
      </button>
      {open && (
        <ul className="tab-panel" aria-label={item.label}>
          {item.children!.map((c) => (
            <li key={c.slug}>
              <Link href={`/${role}${c.slug ? `/${c.slug}` : ""}`} aria-current={section === c.slug ? "page" : undefined} onClick={() => setOpen(false)}>
                {c.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
/** Job-based destinations. Wraps onto rows on narrow screens: no sideways scrolling. */
export function Tabs({ items, role, section, count }: { items: NavItem[]; role: Role; section: string; count?: Record<string, number> }) {
  const current = activeEntry(items, section);
  const { nav, bar } = useTabIndicator(role, current?.label ?? "", count ? JSON.stringify(count) : "");
  return (
    <nav className="tabs" aria-label={`${role} workspace`} ref={nav}>
      <div className="tabs-inner">
        {items.map((item) =>
          item.children ? (
            <TabMenu key={item.label} item={item} role={role} section={section} active={current === item} />
          ) : (
            <Link key={item.label} className={`tab${current === item ? " active" : ""}`} aria-current={current === item ? "page" : undefined} href={`/${role}${item.slug ? `/${item.slug}` : ""}`}>
              {item.label}
              {count?.[item.slug!] !== undefined && <span className="nav-count">{count[item.slug!]}</span>}
            </Link>
          ),
        )}
        <span className="tab-indicator" aria-hidden="true" ref={bar} />
      </div>
    </nav>
  );
}
