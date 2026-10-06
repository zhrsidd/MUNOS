"use client";
export function PrintButton({ label = "Print this sheet" }: { label?: string }) {
  return <button className="button primary no-print" onClick={() => window.print()}>{label}</button>;
}
