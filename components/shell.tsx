"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { activeEntry, type NavItem } from "@/lib/navigation";
import type { Role } from "@/lib/domain";

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
  return (
    <nav className="tabs" aria-label={`${role} workspace`}>
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
      </div>
    </nav>
  );
}
