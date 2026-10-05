"use client";
import { useState } from "react";
import { ACCEPT, MAX_SUBMISSION_BYTES, cleanTitle, kindFromName, submissionMessages, type LinkInfo, type SubmissionResponse } from "@/lib/submissions/rules";

type State =
  | { phase: "idle" }
  | { phase: "sending" }
  | { phase: "done"; status: "created" | "duplicate" | "replayed"; code: string }
  | { phase: "error"; message: string };

export function SubmissionForm({ token, link }: { token: string; link: LinkInfo }) {
  const [submitterId, setSubmitterId] = useState("");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  // One id per intended submission: a retry after a lost response reuses it, so the server
  // returns the original resolution instead of creating a second one.
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  const [state, setState] = useState<State>({ phase: "idle" });
  const contact = link.contact ? ` If it keeps failing, email the file to ${link.contact}.` : " If it keeps failing, give the file to your Chair.";

  function chooseFile(next: File | null) {
    setFile(next);
    setSubmissionId(crypto.randomUUID());
    setState({ phase: "idle" });
    if (next && !kindFromName(next.name)) setState({ phase: "error", message: submissionMessages.invalid_file });
    else if (next && next.size > MAX_SUBMISSION_BYTES) setState({ phase: "error", message: submissionMessages.too_large });
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!submitterId) return setState({ phase: "error", message: submissionMessages.invalid_submitter });
    const clean = cleanTitle(title);
    if (clean.length < 3 || clean.length > 200) return setState({ phase: "error", message: submissionMessages.invalid_title });
    if (!file || !kindFromName(file.name)) return setState({ phase: "error", message: submissionMessages.invalid_file });
    if (file.size > MAX_SUBMISSION_BYTES) return setState({ phase: "error", message: submissionMessages.too_large });
    const form = new FormData();
    form.set("token", token);
    form.set("submissionId", submissionId);
    form.set("submitterId", submitterId);
    form.set("title", clean);
    form.set("file", file);
    setState({ phase: "sending" });
    let response: Response;
    try {
      response = await fetch("/api/submissions", { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
    } catch {
      return setState({ phase: "error", message: `Connection problem — we could not confirm your submission. Check your internet and tap Submit again; it is safe and will not create a duplicate.${contact}` });
    }
    const body = (await response.json().catch(() => null)) as SubmissionResponse | null;
    if (body?.ok) return setState({ phase: "done", status: body.status, code: body.code });
    const message = body?.message ?? (response.status === 413 ? submissionMessages.too_large : submissionMessages.server_error);
    setState({ phase: "error", message: response.status >= 500 || response.status === 429 ? message + contact : message });
  }
  function reset() {
    setTitle("");
    setFile(null);
    setSubmissionId(crypto.randomUUID());
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
            ? "This exact file was already submitted for this committee. Nothing new was created."
            : "The Approval Panel has it now. You do not need to email your Chair. Keep this reference number."}
        </p>
        <button className="button" onClick={reset}>
          Submit another resolution
        </button>
      </section>
    );
  return (
    <form className="submit-card" onSubmit={submit} noValidate>
      <div className="eyebrow">{link.conferenceName}</div>
      <h1>{link.committeeCode} submission</h1>
      <p className="muted">{link.committeeName}</p>
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
        <li>
          <label htmlFor="file">Resolution file</label>
          <input id="file" type="file" accept={ACCEPT} onChange={(e) => chooseFile(e.target.files?.[0] ?? null)} required />
          <small className="muted">PDF or Word, up to 4 MB.</small>
        </li>
      </ol>
      {state.phase === "error" && (
        <p className="submit-error" role="alert">
          {state.message}
        </p>
      )}
      <button className="button primary submit-button" disabled={state.phase === "sending"}>
        {state.phase === "sending" ? "Submitting…" : "Submit resolution"}
      </button>
      <p className="muted submit-note">
        Only the main submitter needs to submit. The Approval Panel receives it automatically.
        {link.contact && <> Problems? Contact {link.contact}.</>}
      </p>
    </form>
  );
}
