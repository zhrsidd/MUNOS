import { createSeed } from "../seed";
import type { LinkInfo } from "./rules";
import { SubmissionRejected, type SubmissionBackend } from "./service";
// LOCAL DEMO ONLY (NEXT_PUBLIC_DATA_BACKEND=local). Keeps submissions in server memory so the
// submission page can be exercised without Supabase. It never runs in a cloud deployment.
// Demo tokens look like demo_<committeeId>_<hex> and resolve against the demo seed.
interface Stored { code: string; source: string; committeeId: string }
const store = (globalThis as { __demoSubmissions?: { byId: Map<string, Stored>; files: Map<string, number> } }).__demoSubmissions ??= { byId: new Map(), files: new Map() };
export function demoSubmissionBackend(): SubmissionBackend {
  const seed = createSeed();
  return {
    async linkInfo(token) {
      const [prefix, committeeId] = token.split("_");
      const committee = seed.committees.find((c) => c.id === committeeId);
      if (prefix !== "demo" || !committee) return null;
      const info: LinkInfo = {
        linkId: token, conferenceId: seed.conference.id, committeeId, conferenceName: seed.conference.name,
        committeeCode: committee.code, committeeName: committee.name, shareWith: "",
        chairs: seed.staff.filter(s=>s.role==="chair" && s.committeeIds.includes(committeeId) && s.email).map(s=>({name:s.name,email:s.email!})),
        submitters: seed.delegates.filter((d) => d.committeeId === committeeId).map((d) => ({ id: d.id, country: d.country, flag: d.flag })).sort((a, b) => a.country.localeCompare(b.country)),
      };
      return info;
    },
    async upload(path, bytes) { store.files.set(path, bytes.length); },
    async remove(path) { store.files.delete(path); },
    async submit(a) {
      const prior = store.byId.get(a.submissionId);
      if (prior) return { status: "replayed", code: prior.code };
      const [, committeeId] = a.token.split("_");
      const source = a.googleDocId ? `doc:${a.googleDocId}` : `file:${a.file?.sha256}`;
      const duplicate = [...store.byId.values()].find((s) => s.committeeId === committeeId && s.source === source);
      if (duplicate) return { status: "duplicate", code: duplicate.code };
      const committee = seed.committees.find((c) => c.id === committeeId);
      if (!committee) throw new SubmissionRejected("invalid_link");
      const count = [...store.byId.values()].filter((s) => s.committeeId === committeeId).length;
      const code = `${committee.code} / D${String(count + 1).padStart(2, "0")}`;
      store.byId.set(a.submissionId, { code, source, committeeId });
      return { status: "created", code };
    },
  };
}
