"use client";
import { useState, useSyncExternalStore } from "react";
import { googleDocMessages, parseGoogleDocLink } from "@/lib/submissions/google-doc";
import { ACCEPT, MAX_SUBMISSION_BYTES, cleanTitle, kindFromName, submissionMessages, type LinkInfo, type SubmissionResponse } from "@/lib/submissions/rules";

type State =
  | { phase: "idle" }
  | { phase: "sending" }
  | { phase: "done"; status: "created" | "duplicate" | "replayed"; code: string }
  | { phase: "error"; message: string };

const subscribeNever = () => () => {};
/** False in server HTML and until React hydrates; true once submit() and the onChange handlers are attached. */
const useHydrated = () => useSyncExternalStore(subscribeNever, () => true, () => false);

/** Delegate page. Normal path: share the Google Doc with the Chair, paste its link. Fallback: upload a file. */
export function SubmissionForm({ token, link }: { token: string; link: LinkInfo }) {
  const hydrated = useHydrated();
  const [submitterId, setSubmitterId] = useState("");
  const [title, setTitle] = useState("");
  const [docLink, setDocLink] = useState("");
  const [shared, setShared] = useState(false);
  const [mode, setMode] = useState<"doc" | "file">("doc");
  const [file, setFile] = useState<File | null>(null);
  // One id per intended submission: a retry after a lost response reuses it, so the server
  // returns the original resolution instead of creating a second one.
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  const [state, setState] = useState<State>({ phase: "idle" });
  const chairs = link.chairs ?? [];
  const help = " If it keeps failing, tell your Chair.";
  const parsedDoc = parseGoogleDocLink(docLink);
  const docError = docLink.trim() && !parsedDoc.ok ? googleDocMessages[parsedDoc.problem] : "";

  const fresh = () => setSubmissionId(crypto.randomUUID());
  function chooseFile(next: File | null) {
    setFile(next);
    fresh();
    setState({ phase: "idle" });
    if (next && !kindFromName(next.name)) setState({ phase: "error", message: submissionMessages.invalid_file });
    else if (next && next.size > MAX_SUBMISSION_BYTES) setState({ phase: "error", message: submissionMessages.too_large });
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!submitterId) return setState({ phase: "error", message: submissionMessages.invalid_submitter });
    const clean = cleanTitle(title);
    if (clean.length < 3 || clean.length > 200) return setState({ phase: "error", message: submissionMessages.invalid_title });
    const form = new FormData();
    if (mode === "doc") {
      if (!parsedDoc.ok) return setState({ phase: "error", message: googleDocMessages[parsedDoc.problem] });
      if (!shared) return setState({ phase: "error", message: "Make sure the Chairs can edit this document, then tick the box." });
      form.set("googleDoc", parsedDoc.url);
    } else {
      if (!file || !kindFromName(file.name)) return setState({ phase: "error", message: submissionMessages.invalid_file });
      if (file.size > MAX_SUBMISSION_BYTES) return setState({ phase: "error", message: submissionMessages.too_large });
      form.set("file", file);
    }
    form.set("token", token);
    form.set("submissionId", submissionId);
    form.set("submitterId", submitterId);
    form.set("title", clean);
    setState({ phase: "sending" });
    let response: Response;
    try {
      response = await fetch("/api/submissions", { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
    } catch {
      return setState({ phase: "error", message: `Connection problem — we could not confirm your submission. Check your internet and tap Submit again; it is safe and will not create a duplicate.${help}` });
    }
    const body = (await response.json().catch(() => null)) as SubmissionResponse | null;
    if (body?.ok) return setState({ phase: "done", status: body.status, code: body.code });
    const message = body?.message ?? (response.status === 413 ? submissionMessages.too_large : submissionMessages.server_error);
    setState({ phase: "error", message: response.status >= 500 || response.status === 429 ? message + help : message });
  }
  function reset() {
    setTitle("");
    setDocLink("");
    setShared(false);
    setFile(null);
    fresh();
    setState({ phase: "idle" });
  }

  if (state.phase === "done")
    return (
      <section className="submit-card success" role="status">
        <div className="eyebrow">{link.committeeCode}</div>
        <h1>{state.status === "duplicate" ? "Already received" : "Resolution received"}</h1>
        <p className="submit-code">{state.code}</p>
        <p>
          {state.status === "duplicate"
            ? "This document was already submitted for this committee. Nothing new was created."
            : mode === "doc"
              ? "Your Chair has it now. Keep editing in Google Docs as your Chair asks; do not remove their access. Your Chair sends it to the Approval Panel."
              : "Your Chair has it now and sends it to the Approval Panel. Keep this reference number."}
        </p>
        <button className="button" onClick={reset}>
          Submit another resolution
        </button>
      </section>
    );
  return (
    <form className="submit-card" method="post" onSubmit={submit} noValidate>
      <div className="eyebrow">{link.conferenceName}</div>
      <h1>{link.committeeCode} resolution submission</h1>
      <p className="muted">{link.committeeName}</p>
      {mode === "doc" && (
        <div className="share-box">
          <strong>Before you submit</strong>
          <span>In Google Docs: Share → General access → <b>Anyone with the link</b> → <b>Editor</b>.</span>
          <span>If your school restricts link sharing, share directly with an assigned Chair as an Editor:</span>
          {chairs.length ? chairs.map(chair=><span className="share-address" key={chair.email}><b>{chair.name}</b><span>{chair.email}</span></span>) : <span>Chair contact emails have not been configured. Ask your committee Chair for their address.</span>}
          <small>Then Share → Copy link. Keep edit access enabled during review and debate.</small>
        </div>
      )}
      {/* Until hydration a native submit reloads the page and loses everything entered, and values typed into these
          controlled fields never reach React state; method="post" is a backstop. */}
      <fieldset disabled={!hydrated} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <ol className="submit-steps">
        <li>
          <label htmlFor="submitter">Main submitter (your country)</label>
          <select id="submitter" value={submitterId} onChange={(e) => setSubmitterId(e.target.value)} required>
            <option value="">Choose your country…</option>
            {link.submitters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.flag} {s.country}
              </option>
            ))}
          </select>
        </li>
        <li>
          <label htmlFor="title">Resolution title</label>
          <input id="title" value={title} maxLength={200} autoComplete="off" placeholder="e.g. Protecting civilians in cyberspace" onChange={(e) => setTitle(e.target.value)} required />
        </li>
        {mode === "doc" ? (
          <li>
            <label htmlFor="doc">Google Doc link</label>
            <input
              id="doc"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={docLink}
              placeholder="https://docs.google.com/document/d/…"
              aria-invalid={!!docError}
              aria-describedby="doc-help"
              onChange={(e) => { setDocLink(e.target.value); fresh(); }}
              required
            />
            <small id="doc-help" className={docError ? "field-error" : "muted"}>
              {docError || (parsedDoc.ok ? "✓ Google Doc link recognised." : "Paste the link from Share → Copy link.")}
            </small>
            <label className="inline share-confirm">
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> I have made sure the Chairs can edit this document.
            </label>
          </li>
        ) : (
          <li>
            <label htmlFor="file">Resolution file</label>
            <input id="file" type="file" accept={ACCEPT} onChange={(e) => chooseFile(e.target.files?.[0] ?? null)} required />
            <small className="muted">PDF or Word, up to 4 MB. Only if you cannot use Google Docs.</small>
          </li>
        )}
      </ol>
      </fieldset>
      {state.phase === "error" && (
        <p className="submit-error" role="alert">
          {state.message}
        </p>
      )}
      <button className="button primary submit-button" disabled={state.phase === "sending" || !hydrated}>
        {!hydrated ? "Loading form…" : state.phase === "sending" ? "Submitting…" : "Submit resolution"}
      </button>
      {!hydrated && <p className="muted" role="status">If this form does not load, ask your Chair how to submit your resolution.</p>}
      <noscript><p className="submit-error" role="alert">This form needs JavaScript to submit. Ask your Chair how to submit your resolution.</p></noscript>
      <button type="button" className="link-button" disabled={!hydrated} onClick={() => { setMode(mode === "doc" ? "file" : "doc"); fresh(); setState({ phase: "idle" }); }}>
        {mode === "doc" ? "Can't use Google Docs? Upload a file instead" : "Use a Google Doc link instead"}
      </button>
      <p className="muted submit-note">Only the main submitter submits. No account is needed — your Chair is notified automatically.</p>
    </form>
  );
}
