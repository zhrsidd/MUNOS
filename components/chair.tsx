"use client";
import Link from "next/link";
import { useState } from "react";
import { useConference } from "@/lib/context";
import { AttendanceStatus, Delegate } from "@/lib/domain";
import { participationSummary, suggestedDelegates, votingOutcome, effectiveScoring } from "@/lib/repository";
import {
  Chip,
  DelegateIdentity,
  Empty,
  Icon,
  Modal,
  PageHeading,
  Panel,
  Timer,
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
  const [manual, setManual] = useState("");
  const [awardDelegate, setAwardDelegate] = useState(
    data.delegates.find((d) => d.committeeId === committeeId)?.id || "",
  );
  const [awardNotes, setAwardNotes] = useState(
    data.awardScores.find((s) => s.delegateId === awardDelegate)?.notes || "",
  );
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
  const queue = data.queue
    .filter((q) => q.sessionId === sessionId)
    .sort((a, b) => a.position - b.position);
  const speaker = data.delegates.find((d) => d.id === queue[0]?.delegateId);
  const attendance = data.attendance.filter((a) => a.sessionId === sessionId);
  const present = attendance.filter((a) => a.status !== "Absent").length;
  const pv = attendance.filter((a) => a.status === "Present & Voting").length;
  const events = data.events
    .filter((e) => e.sessionId === sessionId && !e.voidedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const suggestions = suggestedDelegates(data, sessionId).slice(0, 4);
  const detail = delegates.find((d) => d.id === selected);
  const edit = data.events.find((e) => e.id === eventEdit);
  const voteList = data.votes.filter(
    (v) => v.resolutionId === resolution?.id && v.sessionId === sessionId,
  );
  if (!session)
    return (
      <>
        <PageHeading
          eyebrow={committee.code}
          title="Ready when you are"
          description="Create a session in Administrator to begin roll call and debate."
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
    awards: [
      "Award notes",
      "Participation is context. Your judgment decides the awards.",
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
      {!section && (
        <>
          <div className="context-strip">
            <div>
              <span className="mini-label">ON THE FLOOR</span>
              <strong>
                {resolution?.code || "General debate"}{" "}
                <span className="context-title">
                  {resolution?.title || "No resolution in debate"}
                </span>
              </strong>
            </div>
            <div>
              {resolution && <Chip>{resolution.status}</Chip>}
              <Link href="/chair/documents">View document ↗</Link>
            </div>
          </div>
          <div className="chair-grid">
            <div className="debate-main">
              <Panel
                title="Current speaker"
                subtitle="Give the floor. Record the contribution."
                action={<Chip tone="neutral">{queue.length} in queue</Chip>}
                className="speaker-panel"
              >
                {speaker ? (
                  <>
                    <div className="current-speaker">
                      <span className="speaker-flag">{speaker.flag}</span>
                      <div>
                        <div className="eyebrow">RECOGNIZED DELEGATION</div>
                        <h2>{speaker.country}</h2>
                        <p>
                          {speaker.name} <span>·</span>{" "}
                          {
                            data.schools.find((s) => s.id === speaker.schoolId)
                              ?.name
                          }
                        </p>
                      </div>
                    </div>
                    <div className="scorer-heading">
                      RECORD PARTICIPATION <span>Chair-awarded points</span>
                    </div>
                    <Scorer
                      delegate={speaker}
                      sessionId={sessionId}
                      resolutionId={resolution?.id || null}
                    />
                    <div className="speaker-bottom">
                      <span>
                        {participationSummary(data, speaker.id).opportunities}{" "}
                        opportunities this conference <span>·</span>{" "}
                        {participationSummary(data, speaker.id).points} quality
                        points
                      </span>
                      <button
                        className="primary"
                        onClick={() =>
                          void act(
                            { type: "queue", sessionId, advance: true },
                            "chair",
                          )
                        }
                      >
                        Next speaker <Icon name="arrow" />
                      </button>
                    </div>
                  </>
                ) : (
                  <Empty
                    title="The floor is open"
                    text="Add a suggested delegate to start the speaker queue."
                  />
                )}
              </Panel>
              <Panel
                title="Give someone a turn"
                subtitle="Present delegates with fewer opportunities. Quality points do not determine priority."
                action={<Icon name="attendance" />}
              >
                <div className="suggestion-list">
                  {suggestions.map((d) => (
                    <div className="suggestion" key={d.id}>
                      <DelegateIdentity delegate={d} />
                      <div className="suggestion-action">
                        <span>
                          <strong>
                            {participationSummary(data, d.id).opportunities}
                          </strong>{" "}
                          opportunities
                        </span>
                        <button
                          aria-label={`Add ${d.country} to speaker queue`}
                          onClick={() =>
                            void act(
                              { type: "queue", sessionId, delegateId: d.id },
                              "chair",
                            )
                          }
                        >
                          + Queue
                        </button>
                      </div>
                    </div>
                  ))}
                  {suggestions.length === 0 && (
                    <Empty
                      title="Everyone is accounted for"
                      text="Check roll call or advance the speaker queue."
                    />
                  )}
                </div>
              </Panel>
            </div>
            <div className="debate-side">
              <Timer sessionId={sessionId} />
              <Panel
                title="Up next"
                action={<span className="muted">Speaker queue</span>}
              >
                <div className="queue-list">
                  {queue.slice(1).map((q, i) => {
                    const d = data.delegates.find(
                      (d) => d.id === q.delegateId,
                    )!;
                    return (
                      <div key={q.id}>
                        <span className="queue-number">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <DelegateIdentity delegate={d} />
                      </div>
                    );
                  })}
                  {queue.length < 2 && (
                    <p className="muted">No delegates waiting.</p>
                  )}
                </div>
                <form
                  className="inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (manual)
                      void act(
                        { type: "queue", sessionId, delegateId: manual },
                        "chair",
                      );
                    setManual("");
                  }}
                >
                  <select
                    aria-label="Choose delegate to queue"
                    required
                    value={manual}
                    onChange={(e) => setManual(e.target.value)}
                  >
                    <option value="">Add a delegate…</option>
                    {delegates
                      .filter(
                        (d) =>
                          attendance.some(
                            (a) =>
                              a.delegateId === d.id && a.status !== "Absent",
                          ) && !queue.some((q) => q.delegateId === d.id),
                      )
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.country}
                        </option>
                      ))}
                  </select>
                  <button aria-label="Add selected delegate to queue">+</button>
                </form>
              </Panel>
              <Link href="/chair/roll-call" className="attendance-card">
                <div>
                  <Icon name="attendance" />
                  <strong>Room readiness</strong>
                  <span>View roll call →</span>
                </div>
                <div className="readiness">
                  <strong>
                    {present}
                    <small> / {delegates.length}</small>
                  </strong>
                  <span>
                    delegates present
                    <br />
                    {pv} present & voting
                  </span>
                </div>
              </Link>
            </div>
          </div>
          <Panel
            title="Recent contributions"
            subtitle="A traceable record, without another tally sheet."
            action={
              <Link href="/chair/participation">Full participation log →</Link>
            }
          >
            <div className="event-mini">
              {events.slice(0, 4).map((e) => {
                const d = data.delegates.find((d) => d.id === e.delegateId)!;
                return (
                  <div key={e.id}>
                    <span className="flag">{d.flag}</span>
                    <strong>{d.country}</strong>
                    <span>
                      {data.scoring.find((s) => s.id === e.categoryId)?.label}
                    </span>
                    <Chip tone="blue">+{e.points}</Chip>
                    <time>{formatTime(e.createdAt)}</time>
                    <button
                      className="text-button"
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
                );
              })}
            </div>
          </Panel>
          <div className="chair-note">
            <Icon name="review" />
            Speaker assistance balances opportunity. Award decisions remain with
            the chairs.
            <Link href="/projector" target="_blank">
              Open projector ↗
            </Link>
          </div>
        </>
      )}
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
            <Metric value={events.length} label="Opportunities recorded" />
            <Metric
              value={events.reduce((n, e) => n + e.points, 0)}
              label="Chair-awarded quality points"
            />
            <Metric
              value={new Set(events.map((e) => e.delegateId)).size}
              label="Delegates heard"
            />
            <Metric
              value={
                delegates.filter(
                  (d) => !events.some((e) => e.delegateId === d.id),
                ).length
              }
              label="Yet to contribute"
            />
          </div>
          <Panel
            title="Quick entry"
            subtitle="Select a delegate, then tap a point value."
            action={<Search value={search} onChange={setSearch} />}
          >
            <div className="participation-delegates">
              {filtered.map((d) => (
                <div className="participation-row" key={d.id}>
                  <DelegateIdentity delegate={d} />
                  <span className="opportunity-total">
                    {participationSummary(data, d.id).opportunities} turns{" "}
                    <strong>
                      {participationSummary(data, d.id).points} pts
                    </strong>
                  </span>
                  <Scorer
                    delegate={d}
                    sessionId={sessionId}
                    resolutionId={resolution?.id || null}
                  />
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
                        {data.scoring.find((s) => s.id === e.categoryId)?.label}
                      </td>
                      <td>
                        <Chip tone="blue">+{e.points}</Chip>
                      </td>
                      <td>
                        {data.documents.find((d) => d.id === e.resolutionId)
                          ?.code || "General debate"}
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
        </>
      )}
      {section === "voting" && (
        <>
          <div className="context-strip">
            <div>
              <span className="mini-label">RESOLUTION IN DEBATE</span>
              <strong>
                {resolution?.code}{" "}
                {resolution?.title || "No resolution currently in debate"}
              </strong>
            </div>
            {resolution && <Chip>{resolution.status}</Chip>}
          </div>
          <div className="metrics">
            <Metric
              value={voteList.filter((v) => v.choice === "For").length}
              label="For"
            />
            <Metric
              value={voteList.filter((v) => v.choice === "Against").length}
              label="Against"
            />
            <Metric
              value={voteList.filter((v) => v.choice === "Abstain").length}
              label="Abstain"
            />
            <Metric
              value={Math.max(0, present - voteList.length)}
              label="Awaiting vote"
            />
          </div>
          {resolution ? (
            <Panel
              title="Record votes"
              subtitle="One choice per eligible delegate. Changing a choice updates the totals."
            >
              <div className="roll-list">
                {delegates.map((d) => {
                  const a = attendance.find((a) => a.delegateId === d.id);
                  const eligible = a && a.status !== "Absent";
                  const vote = voteList.find((v) => v.delegateId === d.id);
                  return (
                    <div className="roll-row" key={d.id}>
                      <DelegateIdentity delegate={d} />
                      <div className="vote-controls">
                        <small>{a?.status || "Not called"}</small>
                        {(["For", "Against", "Abstain"] as const).map(
                          (choice) => (
                            <button
                              disabled={
                                !eligible ||
                                (a.status === "Present & Voting" &&
                                  choice === "Abstain")
                              }
                              key={choice}
                              className={
                                vote?.choice === choice ? "selected" : ""
                              }
                              aria-pressed={vote?.choice === choice}
                              onClick={() =>
                                void act(
                                  {
                                    type: "vote",
                                    delegateId: d.id,
                                    sessionId,
                                    resolutionId: resolution.id,
                                    choice,
                                  },
                                  "chair",
                                )
                              }
                            >
                              {choice}
                            </button>
                          ),
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="panel-bottom">
                <span>
                  {voteList.length} of {present} eligible delegates recorded.
                  Outcome follows the configured voting rule.
                </span>
                <button
                  className="primary"
                  disabled={voteList.length !== present || !present}
                  onClick={() => setSelected("outcome")}
                >
                  Close voting & set outcome
                </button>
              </div>
            </Panel>
          ) : (
            <Empty
              title="No voting in progress"
              text="Move a printed resolution into debate from Documents to open voting."
            />
          )}
        </>
      )}
      {section === "awards" && (
        <>
          <div className="callout">
            <Icon name="awards" />
            <div>
              <strong>History informs. Chairs decide.</strong>
              <p>
                Opportunity counts and quality points are evidence, not an
                automatic Best Delegate ranking. Consider diplomacy, research,
                and constructive leadership.
              </p>
            </div>
          </div>
          <div className="two-column">
            <Panel
              title="Chair assessment"
              subtitle="Subjective criteria, recorded separately from participation."
            >
              <label>
                Delegate
                <select
                  value={awardDelegate}
                  onChange={(e) => {
                    setAwardDelegate(e.target.value);
                    setAwardNotes(
                      data.awardScores.find(
                        (s) => s.delegateId === e.target.value,
                      )?.notes || "",
                    );
                  }}
                >
                  {delegates.map((d) => (
                    <option value={d.id} key={d.id}>
                      {d.country} · {d.name}
                    </option>
                  ))}
                </select>
              </label>
              {data.criteria.map((c) => {
                const score = data.awardScores.find(
                  (s) =>
                    s.delegateId === awardDelegate && s.criterionId === c.id,
                );
                return (
                  <div className="criterion" key={c.id}>
                    <strong>{c.name}</strong>
                    <p>{c.description}</p>
                    <div className="rating" role="group" aria-label={c.name}>
                      {Array.from({ length: c.max + 1 }, (_, i) => (
                        <button
                          key={i}
                          aria-pressed={score?.score === i}
                          className={score?.score === i ? "selected" : ""}
                          onClick={() =>
                            void act(
                              {
                                type: "award",
                                delegateId: awardDelegate,
                                criterionId: c.id,
                                score: i,
                                notes: awardNotes,
                              },
                              "chair",
                            )
                          }
                        >
                          {i}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              <label>
                Chair notes
                <textarea
                  value={awardNotes}
                  onChange={(e) => setAwardNotes(e.target.value)}
                  placeholder="Evidence, examples, and context for the final discussion…"
                />
              </label>
              <button
                className="primary"
                disabled={
                  !data.awardScores.some((s) => s.delegateId === awardDelegate)
                }
                onClick={() => {
                  const score = data.awardScores.find(
                    (s) => s.delegateId === awardDelegate,
                  );
                  if (score)
                    void act(
                      {
                        type: "award",
                        delegateId: awardDelegate,
                        criterionId: score.criterionId,
                        score: score.score,
                        notes: awardNotes,
                      },
                      "chair",
                    );
                }}
              >
                Save notes with assessment
              </button>
            </Panel>
            <Panel
              title="Participation context"
              subtitle="Alphabetical reference, not an award leaderboard."
            >
              {[...delegates]
                .sort((a, b) => a.country.localeCompare(b.country))
                .map((d) => {
                  const summary = participationSummary(data, d.id);
                  return (
                    <div className="summary-row" key={d.id}>
                      <DelegateIdentity delegate={d} />
                      <span>
                        {summary.opportunities} turns{" "}
                        <strong>{summary.points} pts</strong>
                      </span>
                    </div>
                  );
                })}
              <div className="footnote">
                Final award selection is intentionally left to chair
                deliberation.
              </div>
            </Panel>
          </div>
        </>
      )}
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
      {edit && (
        <Modal title="Edit contribution" onClose={() => setEventEdit(null)}>
          <p>
            {data.delegates.find((d) => d.id === edit.delegateId)?.country} ·{" "}
            {data.scoring.find((s) => s.id === edit.categoryId)?.label}
          </p>
          <div className="rating">
            {(committee.scoringOverrides || data.scoring)
              .find((s) => s.id === edit.categoryId)
              ?.values.map((points) => (
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
