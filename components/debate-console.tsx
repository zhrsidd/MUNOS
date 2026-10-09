"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useConference } from "@/lib/context";
import { suggestedDelegates } from "@/lib/repository";
import type { Command } from "@/lib/commands";
import type { Delegate } from "@/lib/domain";
import type { Lane, SpeechKind } from "@/lib/procedure/types";
import { activeAmendment, activeLane, activePoi, FLOOR_NOT_WITH_CHAIR, laneEntries, nextPoi, nextSpeaker, poiEntries } from "@/lib/procedure/view";
import { scoringValues } from "@/lib/scoring";
import { Chip, DelegateIdentity, Panel, Timer } from "./ui";

type QueueRow = { id: string; delegateId: string; position: number };

function OrderedQueue({ entries, delegates, scope, onOrder, actions }: {
  entries: QueueRow[];
  delegates: Delegate[];
  scope: string;
  onOrder: (ids: string[]) => void;
  actions: (entry: QueueRow) => ReactNode;
}) {
  const [dragged, setDragged] = useState<string | null>(null);
  function move(id: string, target: number) {
    const ids = entries.map(e => e.id);
    const from = ids.indexOf(id);
    if (from < 0 || from === target || target < 0 || target >= ids.length) return;
    ids.splice(from, 1);
    ids.splice(target, 0, id);
    onOrder(ids);
  }
  return <ol className="procedure-queue" aria-label={scope}>
    {entries.map((entry, index) => {
      const delegate = delegates.find(d => d.id === entry.delegateId);
      if (!delegate) return null;
      return <li key={entry.id} className={dragged === entry.id ? "is-dragging" : ""}
        onDragOver={e => { if (dragged) e.preventDefault(); }}
        onDrop={e => {
          e.preventDefault();
          const id = e.dataTransfer.getData(`text/x-conference-${scope.replace(/\W/g, "-").toLowerCase()}`);
          if (id) move(id, index);
          setDragged(null);
        }}>
        <div className="procedure-queue-identity">
          <span className="procedure-drag" draggable title="Drag to reorder; use arrow buttons with a keyboard"
            onDragStart={e => {
              setDragged(entry.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData(`text/x-conference-${scope.replace(/\W/g, "-").toLowerCase()}`, entry.id);
            }} onDragEnd={() => setDragged(null)} aria-hidden="true">⠿</span>
          <span className="procedure-position">{index + 1}</span>
          <DelegateIdentity delegate={delegate} />
        </div>
        <div className="procedure-row-actions">
          <div className="procedure-order">
            <button type="button" aria-label={`Move ${delegate.country} up in ${scope}`} disabled={index === 0} onClick={() => move(entry.id, index - 1)}>↑</button>
            <button type="button" aria-label={`Move ${delegate.country} down in ${scope}`} disabled={index === entries.length - 1} onClick={() => move(entry.id, index + 1)}>↓</button>
          </div>
          {actions(entry)}
        </div>
      </li>;
    })}
  </ol>;
}

export function DebateConsole({ committeeId, sessionId }: { committeeId: string; sessionId: string }) {
  const { data, act } = useConference();
  const [selection, setSelection] = useState("");
  const [poiSelection, setPoiSelection] = useState("");
  const [yieldSelection, setYieldSelection] = useState("");
  const [classification, setClassification] = useState<Exclude<SpeechKind, "Co-Submitter" | "Main Submitter">>("Other");
  const [customLimit, setCustomLimit] = useState("4");
  const [busy, setBusy] = useState(false);
  const delegates = data.delegates.filter(d => d.committeeId === committeeId);
  const present = delegates.filter(d => data.attendance.some(a => a.sessionId === sessionId && a.delegateId === d.id && a.status !== "Absent"));
  const country = (id: string | undefined) => delegates.find(d => d.id === id)?.country ?? "Delegation";
  const resolution = data.documents.find(d => d.committeeId === committeeId && d.status === "In Debate");
  const amendment = activeAmendment(data, committeeId);
  const passedAmendments = (data.amendments ?? []).filter(a => a.resolutionId === resolution?.id && a.outcome === "Passed");
  const state = data.debateStates?.find(s => s.sessionId === sessionId);
  const mode = state?.mode ?? "open";
  const phase = state?.phase ?? "for";
  const currentLane = activeLane(data, sessionId);
  const active = data.speeches?.find(s => s.sessionId === sessionId && s.state !== "finished");
  const speaker = delegates.find(d => d.id === active?.delegateId);
  const speechRecorded = active && data.events.some(e => e.speechId === active.id && e.categoryId === "speech");
  const speechValues = scoringValues(data, committeeId, "speech");
  const poiValues = scoringValues(data, committeeId, "poi");
  const poiQueue = active ? poiEntries(data, active.id) : [];
  const poiActive = active ? activePoi(data, active.id) : undefined;
  const poiNext = active ? nextPoi(data, active.id) : undefined;
  const poiWaiting = poiQueue.filter(p => !p.recognizedAt);
  const allowanceOpen = active?.state === "pois" && (active.poiLimit === null || active.poiCount < active.poiLimit);
  const next = nextSpeaker(data, sessionId);
  const selectedDelegate = present.some(d => d.id === selection) ? selection : present[0]?.id ?? "";
  const poiDelegates = present.filter(d => d.id !== active?.delegateId && !poiQueue.some(p => p.delegateId === d.id));
  const selectedPoi = poiDelegates.some(d => d.id === poiSelection) ? poiSelection : poiDelegates[0]?.id ?? "";
  const yieldDelegates = present.filter(d => d.id !== active?.delegateId);
  const selectedYield = yieldDelegates.some(d => d.id === yieldSelection) ? yieldSelection : yieldDelegates[0]?.id ?? "";
  const mainSubmitter = present.find(d => d.id === resolution?.submitterId);
  const suggested = suggestedDelegates(data, sessionId).filter(d => d.id !== active?.delegateId).slice(0, 3);
  const lanes: Lane[] = mode === "open" ? ["open"] : ["for", "against"];
  async function send(command: Command) {
    if (busy) return;
    setBusy(true);
    try { await act(command, "chair"); } finally { setBusy(false); }
  }
  function start(delegateId: string, kind: Exclude<SpeechKind, "Co-Submitter">, entryId?: string) {
    // amendmentId records the context the Chair saw; the server refuses it if the amendment debate changed meanwhile.
    void send({ type: "speechStart", sessionId, delegateId, classification: kind, resolutionId: resolution?.id ?? null, amendmentId: amendment?.id ?? null, entryId });
  }
  function closeAmendment(outcome: "Passed" | "Failed" | "Withdrawn") {
    if (!amendment || (outcome === "Withdrawn" && !window.confirm("Record this amendment as withdrawn?"))) return;
    void send({ type: "amendmentStatus", id: amendment.id, status: "Closed", outcome });
  }
  const customValid = Number.isInteger(Number(customLimit)) && customLimit.trim() !== "" && Number(customLimit) >= (active?.poiCount ?? 0) && Number(customLimit) <= 1000;

  if (!sessionId) return <Panel title="Choose a current session"><p>Set the committee’s current session to begin debate.</p></Panel>;
  return <div className="procedure-console">
    {amendment && resolution ? <section className="procedure-context amendment-debate" aria-label="Amendment in debate" role="status">
      <div>
        <span className="eyebrow">AMENDMENT IN DEBATE</span>
        <h2>{amendment.type} · {amendment.clause}</h2>
        <p className="amendment-paused">Resolution debate paused · amendment has priority</p>
        <dl className="amendment-facts">
          <div><dt>Resolution</dt><dd>{resolution.code} · {resolution.title}</dd></div>
          <div><dt>Submitted by</dt><dd>{country(amendment.submitterId)}</dd></div>
          <div><dt>Type</dt><dd>{amendment.type}</dd></div>
          <div><dt>Clause</dt><dd>{amendment.clause}</dd></div>
        </dl>
        <blockquote className="amendment-wording">{amendment.wording}</blockquote>
      </div>
      <div className="amendment-actions">
        <button className="primary" disabled={busy || !!active} onClick={() => closeAmendment("Passed")}>Pass amendment</button>
        <button disabled={busy || !!active} onClick={() => closeAmendment("Failed")}>Fail amendment</button>
        <button disabled={busy || !!active} onClick={() => closeAmendment("Withdrawn")}>Withdraw</button>
        {active && <p className="footnote" role="note">{FLOOR_NOT_WITH_CHAIR}</p>}
        <Link className="button" href="/chair/amendments">Rule out in Amendments →</Link>
      </div>
    </section> : <section className="procedure-context" aria-label="Current resolution">
      <div><span className="eyebrow">{resolution ? "RESOLUTION IN DEBATE" : "ON THE FLOOR"}</span><h2>{resolution?.title ?? "General debate"}</h2><p>{resolution ? `${resolution.code} · ${resolution.status}` : "You can recognize speeches before a resolution enters debate."}</p></div>
      <Link className="button" href="/chair/documents">Documents →</Link>
    </section>}
    {!amendment && passedAmendments.length > 0 && <div className="callout amendment-applied" role="note">
      <strong>Apply the passed amendment to the working Google Doc.</strong>
      <p>Conference OS records the outcome only. Passed for {resolution?.code}: {passedAmendments.map(a => `${a.type} · ${a.clause} (${country(a.submitterId)})`).join("; ")}.</p>
    </div>}
    <div className="procedure-live-grid">
      <Panel title={speaker ? "The floor is with" : "The floor is with the Chair"} action={active ? <Chip tone="blue">{active.classification}{active.amendmentId ? " · amendment" : ""}</Chip> : undefined}>
        <div className="procedure-active">
          {speaker && active ? <>
            <DelegateIdentity delegate={speaker} detail />
            {active.classification === "Co-Submitter" && <p className="footnote">Yielded by the Main Submitter. This speaker returns the floor to the Chair.</p>}
            <div className="procedure-score">
              <div><strong>{speechRecorded ? "Speech recorded" : "Record this speech"}</strong><p>{speechRecorded ? "Corrections are available in Participation." : "Choose the configured speech value when delivered."}</p></div>
              <div className="procedure-buttons">{speechValues.map(points => <button key={points} disabled={busy || !!speechRecorded} aria-label={`Record ${speaker.country} speech for ${points} points`} onClick={() => void send({ type: "speechScore", sessionId, speechId: active.id, points })}>+{points}</button>)}</div>
            </div>
            {active.classification === "Main Submitter" && <form className="procedure-inline-form" onSubmit={e => { e.preventDefault(); if (selectedYield) void send({ type: "speechYield", sessionId, speechId: active.id, delegateId: selectedYield }); }}>
              <label>Yield to a Co-Submitter<select value={selectedYield} onChange={e => setYieldSelection(e.target.value)}><option value="" disabled>Choose a present delegate</option>{yieldDelegates.map(d => <option key={d.id} value={d.id}>{d.country} · {d.name}</option>)}</select></label>
              <button disabled={busy || !selectedYield}>Yield floor</button>
            </form>}
            <button className="primary" disabled={busy} onClick={() => void send({ type: "speechFinish", sessionId, speechId: active.id })}>Finish · return floor to Chair</button>
          </> : <>
            {next ? <button className="primary next-speaker" disabled={busy} onClick={() => start(next.delegateId, currentLane === "for" ? "For" : currentLane === "against" ? "Against" : classification, next.id)}>Next speaker · {country(next.delegateId)}</button>
              : <p>{mode === "closed" ? `No delegates waiting in the ${phase === "for" ? "For" : "Against"} queue.` : "No delegates waiting in the speaker queue."}</p>}
            <p className="footnote">Recognizes position 1 of the {mode === "open" ? "speaker queue" : `${phase === "for" ? "For" : "Against"} queue`}. Reorder the queue first to call someone else.</p>
            {resolution && !amendment && <button disabled={busy || !mainSubmitter} onClick={() => mainSubmitter && start(mainSubmitter.id, "Main Submitter")}>Invite Main Submitter{mainSubmitter ? ` · ${mainSubmitter.country}` : " (mark present first)"}</button>}
          </>}
        </div>
      </Panel>
      <Timer sessionId={sessionId} />
    </div>
    {active && <Panel title="Points of information" subtitle="Recognize the first POI, let the delegate ask it, then record its configured value. Recognition alone records nothing." action={<Chip tone="neutral">{active.poiCount} heard · {active.poiLimit === null ? "Any" : active.poiLimit} allowed</Chip>}>
      <div className="procedure-pois">
        <fieldset className="procedure-allowance"><legend>POIs accepted by the speaker</legend><div className="procedure-buttons">{[0, 1, 2, 3, null].map(limit => <button type="button" key={String(limit)} aria-pressed={active.poiLimit === limit && active.state === "pois"} disabled={busy || (limit !== null && limit < active.poiCount)} onClick={() => void send({ type: "poiAllowance", sessionId, speechId: active.id, limit })}>{limit === null ? "Any" : limit === 0 ? "None" : limit}</button>)}</div></fieldset>
        <form className="procedure-inline-form procedure-custom" onSubmit={e => { e.preventDefault(); if (customValid) void send({ type: "poiAllowance", sessionId, speechId: active.id, limit: Number(customLimit) }); }}><label>Custom total<input type="number" min={active.poiCount} max={1000} step={1} value={customLimit} onChange={e => setCustomLimit(e.target.value)} /></label><button disabled={busy || !customValid}>Set allowance</button><button type="button" disabled={busy || active.poiLimit === null || active.poiLimit >= 1000} onClick={() => void send({ type: "poiAllowance", sessionId, speechId: active.id, limit: Math.max(active.poiLimit ?? 0, active.poiCount) + 1 })}>Extend POIs +1</button></form>
        {poiActive ? <div className="procedure-score poi-active" role="status">
          <div><strong>POI · {country(poiActive.delegateId)} has the floor</strong><p>After the question is asked, record its configured value. This completes the POI.</p></div>
          <div className="procedure-buttons">{poiValues.map(points => <button key={points} disabled={busy} aria-label={`Record ${country(poiActive.delegateId)} POI for ${points} points`} onClick={() => void send({ type: "poiScore", sessionId, speechId: active.id, entryId: poiActive.id, points })}>+{points}</button>)}<button disabled={busy} onClick={() => void send({ type: "poiRemove", sessionId, speechId: active.id, entryId: poiActive.id })}>Withdraw POI</button></div>
        </div> : poiNext ? <button className="primary next-speaker" disabled={busy || !allowanceOpen} onClick={() => void send({ type: "poiRecognize", sessionId, speechId: active.id, entryId: poiNext.id })}>Next POI · {country(poiNext.delegateId)}</button> : null}
        {!poiActive && poiNext && !allowanceOpen && <p className="footnote">Set or extend the allowance before recognizing another POI.</p>}
        <form className="procedure-inline-form" onSubmit={e => { e.preventDefault(); if (selectedPoi) void send({ type: "poiAdd", sessionId, speechId: active.id, delegateId: selectedPoi }); }}><label>Raised placard<select value={selectedPoi} onChange={e => setPoiSelection(e.target.value)}><option value="" disabled>Choose a present delegate</option>{poiDelegates.map(d => <option key={d.id} value={d.id}>{d.country} · {d.name}</option>)}</select></label><button disabled={busy || !selectedPoi}>Add to POI queue</button></form>
        {poiWaiting.length > 0 ? <OrderedQueue entries={poiWaiting} delegates={delegates} scope={`POI queue ${active.id}`} onOrder={ids => void send({ type: "poiOrder", sessionId, speechId: active.id, ids: poiActive ? [poiActive.id, ...ids] : ids })} actions={entry => <button disabled={busy} aria-label={`Remove ${country(entry.delegateId)} from POI queue`} onClick={() => void send({ type: "poiRemove", sessionId, speechId: active.id, entryId: entry.id })}>×</button>} /> : <p className="footnote">No raised placards waiting for this speech.</p>}
      </div>
    </Panel>}
    <Panel title="Debate order" subtitle="Changing debate mode preserves each queue. Chairs choose when to change the phase.">
      <div className="procedure-controls">
        <fieldset><legend>Debate mode</legend><div className="procedure-buttons">{(["open", "closed"] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} disabled={busy} onClick={() => void send({ type: "debateMode", sessionId, mode: value, phase })}>{value === "open" ? "Open debate" : "Closed debate"}</button>)}</div></fieldset>
        {mode === "closed" && <fieldset><legend>Current phase</legend><div className="procedure-buttons">{(["for", "against"] as const).map(value => <button key={value} type="button" aria-pressed={phase === value} disabled={busy} onClick={() => void send({ type: "debateMode", sessionId, mode, phase: value })}>{value === "for" ? "For" : "Against"}</button>)}</div></fieldset>}
        {mode === "open" && <label>Speech classification<select value={classification} onChange={e => setClassification(e.target.value as typeof classification)}><option>Other</option><option>For</option><option>Against</option></select></label>}
      </div>
      <div className="procedure-queue-grid">
        {lanes.map(lane => {
          const entries = laneEntries(data, sessionId, lane);
          const available = present.filter(d => !entries.some(q => q.delegateId === d.id));
          const chosen = available.some(d => d.id === selectedDelegate) ? selectedDelegate : available[0]?.id ?? "";
          return <section className="procedure-lane" key={lane} aria-label={`${lane} speeches`}>
            <div className="procedure-lane-heading"><h3>{lane === "open" ? "Speaker queue" : lane === "for" ? "Speeches for" : "Speeches against"}</h3><Chip tone={lane === currentLane ? "blue" : "neutral"}>{entries.length} waiting{mode === "closed" && lane === phase ? " · current phase" : ""}</Chip></div>
            <form className="procedure-inline-form" onSubmit={e => { e.preventDefault(); if (chosen) void send({ type: "queueAdd", sessionId, delegateId: chosen, lane }); }}><label>Add delegate<select value={chosen} onChange={e => setSelection(e.target.value)}><option value="" disabled>Choose a present delegate</option>{available.map(d => <option key={d.id} value={d.id}>{d.country} · {d.name}</option>)}</select></label><button disabled={busy || !chosen}>+ Queue</button></form>
            {entries.length ? <OrderedQueue entries={entries} delegates={delegates} scope={`${lane} speaker queue`} onOrder={ids => void send({ type: "queueOrder", sessionId, lane, ids })} actions={entry => <button disabled={busy} aria-label={`Remove ${country(entry.delegateId)} from ${lane} speaker queue`} onClick={() => void send({ type: "queueRemove", sessionId, entryId: entry.id })}>×</button>} /> : <p className="footnote">No delegates waiting. Add a raised placard above.</p>}
          </section>;
        })}
      </div>
    </Panel>
    <Panel title="Make room for another voice" subtitle="Suggestions prioritize fewer opportunities, independently of quality points.">
      <div className="procedure-suggestions">{suggested.map(d => <div key={d.id}><DelegateIdentity delegate={d} /><button disabled={busy || data.queue.some(q => q.sessionId === sessionId && q.delegateId === d.id && (q.lane ?? "open") === currentLane)} onClick={() => void send({ type: "queueAdd", sessionId, delegateId: d.id, lane: currentLane })}>+ Queue</button></div>)}</div>
      {!present.length && <p className="footnote">Mark delegates present in <Link href="/chair/roll-call">Roll call</Link> to begin.</p>}
    </Panel>
  </div>;
}
