"use client";
import Link from "next/link";
import { AmendmentInbox } from "./amendments/inbox";
import { PassedAmendmentHistory } from "./amendments/history";
import {DebateConsole} from "./debate-console";
import {VotingConsole} from "./voting-console";
import { useState } from "react";
import { useConference } from "@/lib/context";
import { AttendanceStatus, Delegate } from "@/lib/domain";
import { participationSummary, votingOutcome, effectiveScoring } from "@/lib/repository";
import { frozenOrder, participationOrder } from "@/lib/commands";
import { contributionCount, isContribution } from "@/lib/participation-view";
import { AdjustmentHistory, DeductPoints } from "./point-adjustments";
import { scoringLabel, scoringValues } from "@/lib/scoring";
import { eventAmendmentId } from "@/lib/procedure/view";
import {
  Chip,
  DelegateIdentity,
  Empty,
  Modal,
  PageHeading,
  Panel,
} from "./ui";
export function Scorer({
  delegate,
  sessionId,
  resolutionId,
}: {
  delegate: Delegate;
  sessionId: string;
  resolutionId: string | null;
}) {
  const { data, act } = useConference();
  const definitions = effectiveScoring(data, delegate.committeeId);
  return (
    <div className="scorer">
      {definitions.map((category) => (
        <div key={category.id}>
          <span>{category.label}</span>
          <div>
            {category.values.map((points) => (
              <button
                key={points}
                aria-label={`Record ${category.label} ${points} points for ${delegate.country}`}
                onClick={() =>
                  void act(
                    {
                      type: "participation",
                      delegateId: delegate.id,
                      categoryId: category.id,
                      points,
                      sessionId,
                      resolutionId,
                    },
                    "chair",
                  )
                }
              >
                +{points}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
export function ChairScreen({
  section,
  committeeId,
  sessionId,
}: {
  section: string;
  committeeId: string;
  sessionId: string;
}) {
  const { data, act } = useConference();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [eventEdit, setEventEdit] = useState<string | null>(null);
  const [deducting, setDeducting] = useState<string | null>(null);
  // Order shown while an editor is open or keyboard focus is in the list; null = follow live contributions.
  const [heldOrder, setHeldOrder] = useState<string[] | null>(null);
  const [keyboardInList, setKeyboardInList] = useState(false);
  const [adjusted, setAdjusted] = useState("");
  const committee = data.committees.find((c) => c.id === committeeId)!;
  const session = data.sessions.find((s) => s.id === sessionId);
  const delegates = data.delegates.filter((d) => d.committeeId === committeeId);
  const filtered = delegates.filter((d) =>
    `${d.country} ${d.name} ${data.schools.find((s) => s.id === d.schoolId)?.name}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const resolution = data.documents.find(
    (r) => r.committeeId === committeeId && r.status === "In Debate",
  );
  const attendance = data.attendance.filter((a) => a.sessionId === sessionId);
  const present = attendance.filter((a) => a.status !== "Absent").length;
  const pv = attendance.filter((a) => a.status === "Present & Voting").length;
  const events = data.events
    .filter((e) => e.sessionId === sessionId && !e.voidedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const detail = delegates.find((d) => d.id === selected);
  const edit = data.events.find((e) => e.id === eventEdit);
  const voteList = data.votes.filter(
    (v) => v.resolutionId === resolution?.id && v.sessionId === sessionId,
  );
  if (section === "amendments") return <><AmendmentInbox committeeId={committeeId} /><PassedAmendmentHistory committeeId={committeeId} /></>;
  if (!session)
    return (
      <>
        <PageHeading
          eyebrow={committee.code}
          title="Ready when you are"
          description="Select the current session above to begin roll call and debate."
        />
        <Empty
          title="No session configured"
          text="The committee exists. Add its first session to start recording conference activity."
        />
        <Link className="button primary" href="/admin/sessions">
          Configure sessions
        </Link>
      </>
    );
  const heading = {
    "roll-call": [
      "Roll call",
      "One attendance record per delegate, per session. Voting eligibility updates automatically.",
    ],
    participation: [
      "Participation log",
      "Every contribution has a record. Opportunity counts and chair-awarded points stay separate.",
    ],
    voting: [
      "Voting",
      "Roll call determines who can vote. Present & Voting delegates cannot abstain.",
    ],
  }[section] || [
    "The floor is yours.",
    "Keep the debate moving, and every delegate in the conversation.",
  ];
  return (
    <>
      <PageHeading
        eyebrow={`${committee.code} · ${session.name}`}
        title={heading[0]}
        description={heading[1]}
        action={
          <div className="session-status">
            <span className="dot" />
            {session.state === "active"
              ? "Session active"
              : "Session ready"}{" "}
            <small>{committee.room}</small>
          </div>
        }
      />
      {!section && <DebateConsole committeeId={committeeId} sessionId={sessionId} />}
      {section === "roll-call" && (
        <>
          <div className="metrics">
            <Metric value={present} label="Present in the room" />
            <Metric value={pv} label="Present & Voting" />
            <Metric
              value={attendance.filter((a) => a.status === "Absent").length}
              label="Absent"
            />
            <Metric
              value={delegates.length - attendance.length}
              label="Not yet called"
            />
          </div>
          <Panel
            title="Delegations"
            subtitle={`${session.name} · Select one attendance status`}
            action={<Search value={search} onChange={setSearch} />}
          >
            <div className="roll-list">
              {filtered.map((d) => {
                const status = attendance.find(
                  (a) => a.delegateId === d.id,
                )?.status;
                return (
                  <div className="roll-row" key={d.id}>
                    <button
                      className="identity-button"
                      onClick={() => setSelected(d.id)}
                    >
                      <DelegateIdentity delegate={d} detail />
                    </button>
                    <div
                      className="attendance-segments"
                      role="group"
                      aria-label={`Attendance for ${d.country}`}
                    >
                      {(
                        [
                          "Present",
                          "Present & Voting",
                          "Absent",
                        ] as AttendanceStatus[]
                      ).map((s) => (
                        <button
                          key={s}
                          aria-pressed={s === status}
                          className={s === status ? "selected" : ""}
                          onClick={() =>
                            void act(
                              {
                                type: "attendance",
                                delegateId: d.id,
                                sessionId,
                                status: s,
                              },
                              "chair",
                            )
                          }
                        >
                          {s === status ? "✓ " : ""}
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
          <p className="footnote">
            Changing a delegate to Absent removes their vote in this session.
            Present & Voting removes any abstention. Click a delegation for
            contact details.
          </p>
        </>
      )}
      {section === "participation" && (
        <>
          <div className="metrics">
            <Metric value={contributionCount(events)} label="Contributions this session" />
            <Metric
              value={events.reduce((n, e) => n + e.points, 0) + delegates.reduce((n, d) => n + (data.pointAdjustments ?? []).filter((a) => a.delegateId === d.id && a.sessionId === sessionId).reduce((m, a) => m + a.points, 0), 0)}
              label="Points awarded this session (net)"
            />
            <Metric
              value={new Set(events.filter(isContribution).map((e) => e.delegateId)).size}
              label="Delegates heard"
            />
            <Metric
              value={
                delegates.filter(
                  (d) => !events.some((e) => e.delegateId === d.id && isContribution(e)),
                ).length
              }
              label="Yet to contribute"
            />
          </div>
          <Panel
            title="Quick entry"
            subtitle="Conference totals · most contributions first. Select a delegate, then tap a point value."
            action={<Search value={search} onChange={setSearch} />}
          >
            {keyboardInList && (
              <p className="muted" role="status">
                The order updates when you leave this list.
              </p>
            )}
            {adjusted && (
              <p role="status" className="adjusted-note">
                {adjusted} <a href="#adjustments">View adjustment history</a>
              </p>
            )}
            <div
              className="participation-delegates"
              onFocus={(e) => {
                if (e.target.matches(":focus-visible")) {
                  setKeyboardInList(true);
                  setHeldOrder((h) => h ?? participationOrder(data, filtered).map((x) => x.id));
                }
              }}
              onBlur={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                setKeyboardInList(false);
                if (!deducting && !eventEdit) setHeldOrder(null);
              }}
            >
              {frozenOrder(participationOrder(data, filtered), heldOrder).map((d) => (
                <div className="participation-row" key={d.id}>
                  <DelegateIdentity delegate={d} />
                  <span className="opportunity-total">
                    {participationSummary(data, d.id).opportunities} contributions{" "}
                    <strong>
                      {participationSummary(data, d.id).points} pts
                    </strong>
                  </span>
                  <Scorer
                    delegate={d}
                    sessionId={sessionId}
                    resolutionId={resolution?.id || null}
                  />
                  <button
                    className="text-button"
                    onClick={() => {
                      setHeldOrder(participationOrder(data, filtered).map((x) => x.id));
                      setAdjusted("");
                      setDeducting(d.id);
                    }}
                    aria-label={`Adjust points for ${d.country}`}
                  >
                    Adjust points…
                  </button>
                </div>
              ))}
            </div>
          </Panel>
          <Panel
            title="Event history"
            subtitle="Edit or undo individual events. Totals are always derived from the log."
          >
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Delegation</th>
                    <th>Contribution</th>
                    <th>Points</th>
                    <th>Context</th>
                    <th>Recorded by</th>
                    <th>Time</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td>
                        {
                          data.delegates.find((d) => d.id === e.delegateId)
                            ?.country
                        }
                      </td>
                      <td>
                        {scoringLabel(data, e.categoryId)}
                      </td>
                      <td>
                        <Chip tone="blue">+{e.points}</Chip>
                      </td>
                      <td>
                        {data.documents.find((d) => d.id === e.resolutionId)
                          ?.code || "General debate"}
                        {(() => { const amendment = data.amendments?.find((a) => a.id === eventAmendmentId(data, e)); return amendment ? <> · <Chip tone="review">Amendment debate · {amendment.type} {amendment.clause}</Chip></> : null; })()}
                      </td>
                      <td>Head chair · Demo</td>
                      <td>
                        {formatTime(e.createdAt)}
                        {e.updatedAt && " · edited"}
                      </td>
                      <td>
                        <div className="actions">
                          <button onClick={() => setEventEdit(e.id)}>
                            Edit
                          </button>
                          <button
                            onClick={() =>
                              void act(
                                { type: "event", id: e.id, undo: true },
                                "chair",
                              )
                            }
                          >
                            Undo
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <AdjustmentHistory committeeId={committeeId} />
        </>
      )}
      {section === "voting" && <VotingConsole committeeId={committeeId} sessionId={sessionId} />}
      {detail && (
        <Modal title="Delegate details" onClose={() => setSelected(null)}>
          <DelegateIdentity delegate={detail} detail />
          <dl>
            <dt>Email</dt>
            <dd>
              <a href={`mailto:${detail.email}`}>{detail.email}</a>
            </dd>
            <dt>Committee</dt>
            <dd>
              {committee.code} · {committee.name}
            </dd>
            <dt>Participation history</dt>
            <dd>
              {participationSummary(data, detail.id).opportunities}{" "}
              opportunities · {participationSummary(data, detail.id).points}{" "}
              quality points
            </dd>
          </dl>
        </Modal>
      )}
      {deducting && delegates.find((d) => d.id === deducting) && (
        <DeductPoints
          delegate={delegates.find((d) => d.id === deducting)!}
          sessionId={sessionId}
          onClose={(saved) => {
            const who = delegates.find((d) => d.id === deducting)!;
            setDeducting(null);
            if (!keyboardInList) setHeldOrder(null);
            if (saved) setAdjusted(`Deducted ${saved} ${saved === 1 ? "point" : "points"} from ${who.country}.`);
          }}
        />
      )}
      {edit && (
        <Modal title="Edit contribution" onClose={() => setEventEdit(null)}>
          <p>
            {data.delegates.find((d) => d.id === edit.delegateId)?.country} ·{" "}
            {scoringLabel(data, edit.categoryId)}
          </p>
          <div className="rating">
            {scoringValues(data, committee.id, edit.categoryId)
              .map((points) => (
                <button
                  key={points}
                  onClick={async () => {
                    if (
                      await act({ type: "event", id: edit.id, points }, "chair")
                    )
                      setEventEdit(null);
                  }}
                >
                  +{points}
                </button>
              ))}
          </div>
          <p className="footnote">
            Edits retain the event and add an audit entry.
          </p>
        </Modal>
      )}
      {selected === "outcome" && resolution && (
        <Modal
          title="Confirm resolution outcome"
          onClose={() => setSelected(null)}
        >
          <p>
            For {voteList.filter((v) => v.choice === "For").length} · Against{" "}
            {voteList.filter((v) => v.choice === "Against").length} · Abstain{" "}
            {voteList.filter((v) => v.choice === "Abstain").length}
          </p>
          <p>
            The configured rule gives {votingOutcome(data, resolution.id)}. Abstentions are excluded from the majority calculation.
          </p>
          <div className="actions">
            {([votingOutcome(data, resolution.id), "Withdrawn"] as const).map((outcome) => (
              <button
                key={outcome}
                onClick={async () => {
                  if (
                    await act(
                      {
                        type: "document",
                        id: resolution.id,
                        status: "Closed",
                        outcome,
                      },
                      "chair",
                    )
                  )
                    setSelected(null);
                }}
              >
                {outcome}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
export function Metric({
  value,
  label,
}: {
  value: number | string;
  label: string;
}) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
export function Search({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      className="search"
      type="search"
      aria-label="Search delegates"
      placeholder="Search delegates…"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
export function formatTime(time: string) {
  return new Date(time).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Qatar",
  });
}
