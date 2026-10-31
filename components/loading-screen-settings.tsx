"use client";

import { useState } from "react";
import { useConference } from "../lib/context";
import { loadingScreenFeatureKey } from "../lib/loading-screen";
import { AlternativeLoadingScreen } from "./committee-workspace-loading";
import { Modal, Panel } from "./ui";

export function LoadingScreenSettings() {
  const { data, act } = useConference();
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const committees = data.committees.filter(c => !c.archived);
  async function toggle(id: string, enabled: boolean) {
    setSaving(id);
    setError("");
    try {
      if (!await act({ type: "feature", name: loadingScreenFeatureKey(id), enabled }, "admin")) {
        setError("The loading-screen setting could not be saved. Review sync status and retry.");
      }
    } finally { setSaving(null); }
  }
  return <Panel title="Alternative loading screen" subtitle="Opt in committee by committee. All committees use the standard screen until enabled.">
    <p className="muted small">Returning Chair devices use the last synchronized setting after access is verified. First visits keep the standard screen. Ready workspaces open immediately.</p>
    {committees.length === 0 && <p>No active committees.</p>}
    {committees.map(committee => {
      const enabled = data.conference.features[loadingScreenFeatureKey(committee.id)] === true;
      return <div className="toggle-row" key={committee.id}>
        <div><strong>{committee.code}</strong><p>{committee.name}</p></div>
        <div className="actions">
          <button onClick={() => setPreview(committee.code)} aria-label={`Preview loading screen for ${committee.code}`}>Preview</button>
          <button className={`toggle ${enabled ? "on" : ""}`} role="switch" aria-checked={enabled} aria-label={`Alternative loading screen for ${committee.code}`} disabled={saving !== null} onClick={() => void toggle(committee.id, !enabled)}><span /></button>
        </div>
      </div>;
    })}
    {saving && <p role="status">Saving loading-screen setting…</p>}
    {error && <p role="alert">{error}</p>}
    {preview && <Modal title={`${preview} loading screen preview`} onClose={() => setPreview(null)}>
      <AlternativeLoadingScreen committeeCode={preview} />
      <p className="muted small">Preview only. This does not change the committee setting or simulate loading progress.</p>
      <div className="actions"><button onClick={() => setPreview(null)}>Close preview</button></div>
    </Modal>}
  </Panel>;
}
