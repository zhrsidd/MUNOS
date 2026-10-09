"use client";
import {VetoSettings} from "./veto-settings";
import { CentralSessions } from "./central-sessions";
import { CommitteeManagement } from "./committee-management";
import Link from "next/link";
import { useState } from "react";
import { useConference } from "@/lib/context";
import { Command, repository } from "@/lib/repository";
import { Role } from "@/lib/domain";
import { parseCSV, validateImport } from "@/lib/import";
import { countryFlag } from "@/lib/countries";
import { conferenceScoring, effectiveScoring, isConfigurableScoring, parseScoringValues, REQUIRED_SCORING, scoringProblem } from "@/lib/scoring";
import { Metric, Search } from "./chair";
import { Chip, Empty, Icon, Modal, PageHeading, Panel } from "./ui";
const sections: Record<string, [string, string]> = {
  conference: ["Conference", "Set the defaults that every committee inherits."],
  committees: [
    "Committees",
    "Create as many committees as your conference needs.",
  ],
  sessions: ["Sessions", "Attendance and debate activity belong to a session."],
  delegates: [
    "Delegates",
    "Import once. Validate. Make the conference database authoritative.",
  ],
  schools: ["Schools", "One school record, linked to every delegate."],
  staff: [
    "Chairs & staff",
    "Role and committee assignments are ready for future access controls.",
  ],
  scoring: [
    "Participation scoring",
    "Configure chair-awarded point values. Counts are derived from events.",
  ],
  workflow: [
    "Workflow & features",
    "Keep complexity here, so operational screens stay simple.",
  ],
  resources: [
    "Resources & Drive",
    "Prepare integration boundaries without connecting external services.",
  ],
  audit: ["Audit log", "Trace actions across every workspace."],
  "": [
    "Conference overview",
    "A shared operational picture. Configure here, act in your workspace.",
  ],
};
export function AdminScreen({ section }: { section: string }) {
  const { data, act } = useConference();
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<string | null>(null);
  const [editing, setEditing] = useState("");
  const [scoreScope, setScoreScope] = useState("conference");
  const [saveError, setSaveError] = useState("");
  const heading = sections[section] || sections[""];
  const delegate = data.delegates.find((d) => d.id === editing);
  const filtered = data.delegates.filter((d) =>
    `${d.name} ${d.country} ${d.email} ${data.schools.find((s) => s.id === d.schoolId)?.name}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  async function submit(
    e: React.FormEvent<HTMLFormElement>,
    command: (f: FormData) => Command,
  ) {
    e.preventDefault();
    if (await act(command(new FormData(e.currentTarget)), "admin")) {
      setModal(null);
      setSaveError("");
    }
  }
  if (section === "committees") return <CommitteeManagement />;
  if (section === "sessions" || section === "schedule") return <CentralSessions />;
  return (
    <>
      <PageHeading
        eyebrow="EXECUTIVE"
        title={heading[0]}
        description={heading[1]}
        action={
          section === "delegates" ? (
            <button className="primary" onClick={() => setModal("import")}>
              ↥ Import delegates
            </button>
          ) : ["schools", "staff"].includes(
              section,
            ) ? (
            <button className="primary" onClick={() => setModal(section)}>
              + Add{" "}
              {section === "staff" ? "staff member" : section.slice(0, -1)}
            </button>
          ) : undefined
        }
      />
      {!section && (
        <>
          <div className="metrics">
            <Metric value={data.committees.filter(c => !c.archived).length} label="Active committees" />
            <Metric
              value={data.delegates.length}
              label="Registered delegates"
            />
            <Metric
              value={
                data.documents.filter((d) =>
                  ["Review", "Submitted"].includes(d.status),
                ).length
              }
              label="Awaiting review"
            />
            <Metric
              value={
                data.documents.filter((d) => d.status === "Approved").length
              }
              label="Ready to print"
            />
          </div>
          <div className="two-column">
            <Panel
              title="Committee readiness"
              subtitle="One model, independent committee sessions."
            >
              {data.committees.filter(c => !c.archived).map((c) => {
                const delegates = data.delegates.filter(
                  (d) => d.committeeId === c.id,
                );
                const session = data.sessions.find(
                  (s) => s.id === c.currentSessionId,
                );
                const present = data.attendance.filter(
                  (a) => a.sessionId === session?.id && a.status !== "Absent",
                ).length;
                return (
                  <div className="committee-row" key={c.id}>
                    <span className="committee-badge">{c.code}</span>
                    <div>
                      <strong>{c.name}</strong>
                      <p>
                        {c.room} · {delegates.length} delegates · {present}{" "}
                        present
                      </p>
                    </div>
                    <Chip tone={session ? "green" : "neutral"}>
                      {session ? "Session active" : "Setup"}
                    </Chip>
                  </div>
                );
              })}
              <Link href="/admin/committees" className="card-link">
                Configure committees →
              </Link>
            </Panel>
            <Panel
              title="Make the day work"
              subtitle="Configuration is shared across every role."
            >
              <div className="setup-links">
                {[
                  [
                    "delegates",
                    "Import and validate delegates",
                    "Registration becomes a single source of truth.",
                  ],
                  [
                    "scoring",
                    "Set scoring definitions",
                    "Give chairs fast, consistent point entry.",
                  ],
                  [
                    "resources",
                    "Connect services later",
                    "Supabase and Drive boundaries are prepared.",
                  ],
                ].map(([slug, title, desc]) => (
                  <Link key={slug} href={`/admin/${slug}`}>
                    <Icon
                      name={
                        slug === "delegates"
                          ? "attendance"
                          : "settings"
                      }
                    />
                    <div>
                      <strong>{title}</strong>
                      <p>{desc}</p>
                    </div>
                    <span>→</span>
                  </Link>
                ))}
              </div>
            </Panel>
          </div>
          <div className="callout">
            <Icon name="review" />
            <div>
              <strong>Demo roles are navigation, not authentication.</strong>
              <p>
                Repository commands enforce demo role boundaries for
                development. Production authorization must use server validation
                and Supabase RLS.
              </p>
            </div>
          </div>
        </>
      )}
      {section === "conference" && (
        <div className="two-column">
          <Panel title="Conference details" subtitle="Conference-wide defaults">
            <form
              onSubmit={(e) =>
                void submit(e, (f) => ({
                  type: "conference",
                  name: String(f.get("name")),
                  venue: String(f.get("venue")),
                  date: String(f.get("date")),
                }))
              }
            >
              <label>
                Conference name
                <input
                  name="name"
                  required
                  defaultValue={data.conference.name}
                />
              </label>
              <label>
                Venue
                <input
                  name="venue"
                  required
                  defaultValue={data.conference.venue}
                />
              </label>
              <label>
                Conference date
                <input
                  name="date"
                  type="date"
                  required
                  defaultValue={data.conference.date}
                />
              </label>
              <button className="primary">Save conference</button>
            </form>
          </Panel>
          <Panel title="Defaults & overrides">
            <p>
              Committees inherit the conference scoring definitions. Committee
              overrides can be configured under Scoring without changing other
              committees.
            </p>
            <dl>
              <dt>Participation</dt>
              <dd>Event-based, chair judged</dd>
              <dt>Attendance</dt>
              <dd>Per session, mutually exclusive</dd>
              <dt>Registration</dt>
              <dd>Import and validate once</dd>
              <dt>Document lifecycle</dt>
              <dd>Database authoritative</dd>
            </dl>
          </Panel>
        </div>
      )}
      {section === "delegates" && (
        <>
          <Panel
            title="Delegate directory"
            subtitle={`${data.delegates.length} records · Contact details remain here, not on the Chair Console.`}
            action={<Search value={search} onChange={setSearch} />}
          >
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Delegation</th>
                    <th>Committee</th>
                    <th>School</th>
                    <th>Email</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <strong>{d.name}</strong>
                      </td>
                      <td>
                        {d.flag} {d.country}
                      </td>
                      <td>
                        {
                          data.committees.find((c) => c.id === d.committeeId)
                            ?.code
                        }
                      </td>
                      <td>
                        {data.schools.find((s) => s.id === d.schoolId)?.name}
                      </td>
                      <td>{d.email}</td>
                      <td>
                        <button
                          onClick={() => {
                            setEditing(d.id);
                            setModal("delegate");
                          }}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!filtered.length && (
              <Empty
                title="No matching delegates"
                text="Try a country, school, name, or email."
              />
            )}
          </Panel>
          <div className="callout small">
            <Icon name="attendance" />
            <p>
              Registration Sheets are an import source. There is no live Sheet
              synchronization or duplicated manual tally.
            </p>
          </div>
        </>
      )}
      {section === "schools" && (
        <Panel title="School directory">
          {data.schools.map((s) => (
            <div className="summary-row" key={s.id}>
              <strong>{s.name}</strong>
              <span>
                {data.delegates.filter((d) => d.schoolId === s.id).length}{" "}
                delegates
              </span>
            </div>
          ))}
        </Panel>
      )}
      {section === "staff" && (
        <Panel
          title="Staff assignments"
          subtitle="Assigned Chair contact emails are shown on the committee submission form. Directory contacts do not grant app access."
        >
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Committee scope</th>
                  <th>Contact email</th>
                </tr>
              </thead>
              <tbody>
                {data.staff.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>
                      <Chip tone="blue">{s.role === "admin" ? "Executive" : s.role === "logistics" ? "Admins" : s.role === "approval" ? "Approval Panel" : "Chair"}</Chip>
                    </td>
                    <td>
                      {s.committeeIds
                        .map(
                          (id) =>
                            data.committees.find((c) => c.id === id)?.code,
                        )
                        .join(", ") || "Conference-wide"}
                    </td>
                    <td><StaffContact key={`${s.id}-${s.contactRevision}`} id={s.id} email={s.email ?? ""} name={s.name} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {section === "scoring" && (
        <ScoringSettings scope={scoreScope} setScope={setScoreScope} />
      )}
      {section === "awards" && (
        <Panel title="Awards are chair decisions">
          <p>Chairs discuss awards using their judgement and the factual participation history in their workspace. There is no award rubric or automatic ranking.</p>
          <Link className="card-link" href="/chair/awards">Open chair award discussion →</Link>
        </Panel>
      )}
      {section === "workflow" && <VetoSettings/>}
      {section === "workflow" && (
        <div className="two-column">
          <Panel
            title="Conference features"
            subtitle="Feature settings are saved; operational feature gating is a later integration step."
          >
            {Object.entries(data.conference.features).map(([name, enabled]) => (
              <div className="toggle-row" key={name}>
                <div>
                  <strong>{name}</strong>
                  <p>Conference default</p>
                </div>
                <button
                  className={`toggle ${enabled ? "on" : ""}`}
                  role="switch"
                  aria-checked={enabled}
                  aria-label={name}
                  onClick={() =>
                    void act(
                      { type: "feature", name, enabled: !enabled },
                      "admin",
                    )
                  }
                >
                  <span />
                </button>
              </div>
            ))}
          </Panel>
          <Panel title="Resolution workflow">
            <div className="vertical-workflow">
              {[
                "Draft",
                "Submitted",
                "Review",
                "Approved",
                "Printed",
                "In Debate",
                "Closed",
              ].map((s, i) => (
                <div key={s}>
                  <span>{i + 1}</span>
                  <strong>{s}</strong>
                  <small>
                    {
                      [
                        "Chair prepares",
                        "Chair submits",
                        "Approval Panel reviews",
                        "Review decision",
                        "Admins complete",
                        "Chair introduces",
                        "Chair confirms outcome",
                      ][i]
                    }
                  </small>
                </div>
              ))}
            </div>
            <p className="footnote">
              Closed outcomes: Passed, Failed, or Withdrawn. Workflow
              transitions are validated by the repository.
            </p>
          </Panel>
        </div>
      )}
      {section === "resources" && (
        <>
          <div className="two-column">
            <Panel
              title="Supabase"
              subtitle="Live conference database and file storage"
              action={<Chip tone="neutral">Not connected</Chip>}
            >
              <dl>
                <dt>Postgres</dt>
                <dd>Replace the local repository implementation.</dd>
                <dt>Auth & RLS</dt>
                <dd>Enforce conference, role, and committee scope.</dd>
                <dt>Realtime</dt>
                <dd>Publish record changes, not timer ticks.</dd>
                <dt>Storage</dt>
                <dd>Private, versioned PDFs via storage adapter.</dd>
              </dl>
              <p className="footnote">
                No credentials are requested or stored in this prototype.
              </p>
            </Panel>
            <Panel
              title="Google Shared Drive"
              subtitle="Document archive & emergency fallback"
              action={<Chip tone="neutral">Not connected</Chip>}
            >
              <div className="archive-art">
                <Icon name="documents" />
                <span>Approved document version</span>
                <span>↓ automatic mirror later</span>
                <strong>Conference archive</strong>
              </div>
              <p>
                Drive receives immutable file copies. Workflow state stays in
                the database. A retryable archive job will track mirroring
                separately.
              </p>
            </Panel>
          </div>
          <Panel
            title="Demo data controls"
            subtitle="Reset only affects this browser. It does not change any external files."
          >
            <button onClick={() => setModal("reset")}>Reset local demo</button>
          </Panel>
        </>
      )}
      {section === "audit" && (
        <Panel
          title="Activity trail"
          subtitle="Demo audit entries are locally stored. Production audit records must be server-written and append-only."
        >
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Entity</th>
                  <th>Timestamp · Qatar</th>
                </tr>
              </thead>
              <tbody>
                {data.audit.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.action}</strong>
                    </td>
                    <td>{a.actorId}</td>
                    <td className="mono">{a.entityId}</td>
                    <td>
                      {new Date(a.createdAt).toLocaleString("en-GB", {
                        timeZone: "Asia/Qatar",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {modal === "schools" && (
        <Modal title="Add school" onClose={() => setModal(null)}>
          <form
            onSubmit={(e) =>
              void submit(e, (f) => ({
                type: "school",
                name: String(f.get("name")),
              }))
            }
          >
            <label>
              School name
              <input name="name" required />
            </label>
            <button className="primary">Add school</button>
          </form>
        </Modal>
      )}
      {modal === "staff" && (
        <Modal title="Add staff member" onClose={() => setModal(null)}>
          <form
            onSubmit={(e) =>
              void submit(e, (f) => ({
                type: "staff",
                name: String(f.get("name")),
                role: String(f.get("role")) as Role,
                committeeIds: f.get("committeeId")
                  ? [String(f.get("committeeId"))]
                  : [],
              }))
            }
          >
            <label>
              Name
              <input name="name" required />
            </label>
            <label>
              Role
              <select name="role">
                {["chair", "approval", "logistics", "admin"].map((r) => (
                  <option key={r} value={r}>{r === "admin" ? "Executive" : r === "logistics" ? "Admins" : r === "approval" ? "Approval Panel" : "Chair"}</option>
                ))}
              </select>
            </label>
            <CommitteeSelect optional />
            <button className="primary">Save assignment</button>
          </form>
        </Modal>
      )}
      {modal === "delegate" && delegate && (
        <Modal title="Edit delegate" onClose={() => setModal(null)}>
          <form
            onSubmit={(e) =>
              void submit(e, (f) => ({
                type: "delegate",
                id: delegate.id,
                name: String(f.get("name")),
                country: String(f.get("country")),
                flag: countryFlag(String(f.get("country"))),
                email: String(f.get("email")),
              }))
            }
          >
            <label>
              Name
              <input required name="name" defaultValue={delegate.name} />
            </label>
            <label>
              Delegation
              <input required name="country" defaultValue={delegate.country} />
            </label>
            <label>
              Email
              <input
                required
                name="email"
                type="email"
                defaultValue={delegate.email}
              />
            </label>
            <button className="primary">Save delegate</button>
          </form>
        </Modal>
      )}
      {modal === "import" && (
        <Modal title="Import delegates" onClose={() => setModal(null)}>
          <ImportFlow close={() => setModal(null)} />
        </Modal>
      )}
      {modal === "reset" && (
        <Modal title="Reset demo data?" onClose={() => setModal(null)}>
          <p>
            This clears your local edits and restores the illustrative seed
            records.
          </p>
          <div className="actions">
            <button onClick={() => setModal(null)}>Cancel</button>
            <button
              className="primary"
              onClick={() => {
                repository.reset();
                setModal(null);
              }}
            >
              Restore demo data
            </button>
          </div>
        </Modal>
      )}
      {saveError && <p role="alert">{saveError}</p>}
    </>
  );
}
function CommitteeSelect({ optional = false }: { optional?: boolean }) {
  const { data } = useConference();
  return (
    <label>
      Committee scope
      <select name="committeeId">
        {optional && <option value="">Conference-wide</option>}
        {data.committees.filter(c => !c.archived).map((c) => (
          <option key={c.id} value={c.id}>
            {c.code} · {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}
function ImportFlow({ close }: { close: () => void }) {
  const { data, act } = useConference();
  const [step, setStep] = useState(1);
  const [csv, setCsv] = useState(
    "Name,Country,Email\nLayla Mansour,Italy,layla@example.com\nDaniel Chen,Singapore,daniel@example.com",
  );
  const [rows, setRows] = useState<string[][]>([]);
  const [error, setError] = useState("");
  const [mapping, setMapping] = useState<Record<string, number>>({
    name: 0,
    country: 1,
    email: 2,
  });
  const [committeeId, setCommitteeId] = useState(data.committees[0]?.id ?? "");
  const [schoolId, setSchoolId] = useState(data.schools[0]?.id ?? "");
  const validated = validateImport(
    rows.slice(1),
    mapping,
    data.delegates.map((d) => d.email),
  );
  return (
    <>
      <div className="import-steps">
        {["Paste or upload", "Map columns", "Validate & import"].map((s, i) => (
          <span className={step === i + 1 ? "active" : ""} key={s}>
            {i + 1}. {s}
          </span>
        ))}
      </div>
      {step === 1 && (
        <>
          <p>
            Paste CSV exported from your registration Sheet, or upload a CSV
            file. No live registration sync.
          </p>
          <label>
            CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) setCsv(await file.text());
              }}
            />
          </label>
          <label>
            CSV data
            <textarea
              rows={8}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
            />
          </label>
          <button
            className="primary"
            onClick={() => {
              try {
                const parsed = parseCSV(csv);
                if (parsed.length < 2)
                  throw Error("Include a header and at least one delegate.");
                setRows(parsed);
                setStep(2);
                setError("");
              } catch (e) {
                setError(e instanceof Error ? e.message : "Invalid CSV");
              }
            }}
          >
            Continue to mapping →
          </button>
        </>
      )}
      {step === 2 && (
        <>
          <p>
            Map your column names and choose the committee and school for this
            batch.
          </p>
          {["name", "country", "email"].map((field) => (
            <label key={field}>
              {field[0].toUpperCase() + field.slice(1)}
              <select
                value={mapping[field]}
                onChange={(e) =>
                  setMapping({ ...mapping, [field]: Number(e.target.value) })
                }
              >
                {rows[0]?.map((header, i) => (
                  <option value={i} key={i}>
                    {header}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <div className="form-grid">
            <label>
              Committee
              <select
                value={committeeId}
                onChange={(e) => setCommitteeId(e.target.value)}
              >
                {data.committees.filter(c => !c.archived).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code}
                  </option>
                ))}
              </select>
            </label>
            <label>
              School
              <select
                value={schoolId}
                onChange={(e) => setSchoolId(e.target.value)}
              >
                {data.schools.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="actions">
            <button onClick={() => setStep(1)}>Back</button>
            <button
              className="primary"
              disabled={new Set(Object.values(mapping)).size < 3}
              onClick={() => setStep(3)}
            >
              Validate rows →
            </button>
          </div>
        </>
      )}
      {step === 3 && (
        <>
          <div className="callout small">
            <Icon name="attendance" />
            <p>
              {validated.filter((r) => !r.errors.length).length} valid rows ·{" "}
              {validated.filter((r) => r.errors.length).length} rows with
              errors. All rows must pass before import.
            </p>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Name</th>
                  <th>Country</th>
                  <th>Validation</th>
                </tr>
              </thead>
              <tbody>
                {validated.map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    <td>{r.name}</td>
                    <td>{r.flag} {r.country}</td>
                    <td>
                      {r.errors.length ? (
                        <span className="form-error">
                          {r.errors.join(" · ")}
                        </span>
                      ) : (
                        <Chip tone="green">Ready</Chip>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions">
            <button onClick={() => setStep(1)}>Edit source</button>
            <button
              className="primary"
              disabled={
                !validated.length || validated.some((r) => r.errors.length)
              }
              onClick={async () => {
                if (
                  await act(
                    {
                      type: "import",
                      rows: validated.map((r) => ({
                        name: r.name,
                        country: r.country,
                        flag: r.flag,
                        email: r.email,
                        committeeId,
                        schoolId,
                      })),
                    },
                    "admin",
                  )
                )
                  close();
              }}
            >
              Import {validated.length} delegates
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function StaffContact({id,email,name}:{id:string;email:string;name:string}) {
  const {act}=useConference();
  const [draft,setDraft]=useState(email);
  return <form className="link-field" onSubmit={e=>{e.preventDefault();void act({type:"staffContact",id,email:draft},"admin");}}>
    <input type="email" maxLength={254} aria-label={`${name} contact email`} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Contact email" />
    <button disabled={draft.trim()===email}>Save</button>
  </form>;
}

/** Executive → Scoring. Works on a blank conference: required procedure categories always show, with
 *  built-in defaults until an Executive establishes them. Categories cannot be deleted. */
function ScoringSettings({ scope, setScope }: { scope: string; setScope: (scope: string) => void }) {
  const { data, act } = useConference();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const committee = data.committees.find((c) => c.id === scope);
  const definitions = committee ? effectiveScoring(data, committee.id) : conferenceScoring(data);
  const unsaved = REQUIRED_SCORING.filter((r) => isConfigurableScoring(r.id) && !data.scoring.some((s) => s.id === r.id));
  async function save(id: string, text: string) {
    const values = parseScoringValues(text);
    const problem = scoringProblem(id, values);
    setError(problem ?? "");
    if (problem) return;
    setBusy(true);
    try { await act({ type: "scoring", id, values, committeeId: committee?.id }, "admin"); } finally { setBusy(false); }
  }
  async function establish() {
    setBusy(true);
    try { for (const r of unsaved) if (!(await act({ type: "scoring", id: r.id, values: [...r.values] }, "admin"))) break; } finally { setBusy(false); }
  }
  return (
    <>
      {unsaved.length > 0 && (
        <div className="callout" role="status">
          <strong>Scoring is using built-in defaults</strong>
          <p>Chairs can already record {unsaved.map((r) => `${r.label} ${r.values.join("/")}`).join(", ")}. Establish them as this conference’s defaults, then adjust any values below.</p>
          <button className="primary" disabled={busy} onClick={() => void establish()}>Establish default scoring</button>
        </div>
      )}
      <div className="scope-bar">
        <label>
          Configure scope
          <select value={scope} onChange={(e) => { setScope(e.target.value); setError(""); }}>
            <option value="conference">Conference defaults</option>
            {data.committees.filter((c) => !c.archived).map((c) => (
              <option key={c.id} value={c.id}>{c.code} · Committee override</option>
            ))}
          </select>
        </label>
        <p>{committee ? "Saving a category creates a committee override for that category only; other categories keep the conference default." : "Inherited by all committees unless overridden."}</p>
      </div>
      <Panel title="Point definitions" subtitle="Chairs choose from these values on the Debate Console. One event equals one opportunity, regardless of its quality points.">
        {error && <p className="form-error" role="alert">{error}</p>}
        {definitions.map((s) => {
          if (!isConfigurableScoring(s.id))
            return (
              <div className="definition-row" key={`${scope}-${s.id}`}>
                <div>
                  <strong>{s.label}</strong>
                  <p>Fixed +{s.values[0]}, once per resolution, on the Main Submitter’s first scored speech · locked</p>
                </div>
                <span className="muted">Not configurable</span>
              </div>
            );
          const builtIn = !data.scoring.some((x) => x.id === s.id);
          const overridden = !!committee?.scoringOverrides?.some((x) => x.id === s.id);
          return (
            <form className="definition-row" key={`${scope}-${s.id}-${s.values}`} onSubmit={(e) => { e.preventDefault(); void save(s.id, String(new FormData(e.currentTarget).get("values"))); }}>
              <div>
                <strong>{s.label}</strong>
                <p>{s.id === "speech" ? "Chair-judged value for each delivered speech" : s.id === "poi" ? "Chair-judged value after a recognized POI is asked" : "Chair-awarded points"}{committee ? (overridden ? " · committee override" : " · conference default") : builtIn ? " · built-in default" : ""}</p>
              </div>
              <label>
                Allowed values
                <input name="values" required defaultValue={s.values.join(", ")} aria-label={`${s.label} allowed values`} />
              </label>
              <button disabled={busy}>Save definition</button>
            </form>
          );
        })}
      </Panel>
      <p className="footnote">Historical events retain their original points when definitions change. Speaker suggestions use opportunity counts. Awards remain Chair judgement; there is no automatic ranking.</p>
    </>
  );
}
