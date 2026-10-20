/**
 * Felix's deterministic question understanding. No network and no model: a question is normalised, each word is
 * mapped to a small set of workflow concepts (with synonyms and typo tolerance), and intents declare which concepts
 * they require. The most specific fully matched intent wins; ties between unrelated intents are reported as
 * ambiguous so Felix asks instead of guessing.
 */

/** Workflow concepts. Each lists exact words/phrases; single words also match with small typos (see `fuzzyWord`). */
export const CONCEPTS = {
  resolution: ["resolution", "resolutions", "reso", "resos", "res", "draft", "drafts", "document", "documents", "doc", "docs", "paper", "papers", "google doc"],
  amendment: ["amendment", "amendments", "amend", "amending", "amended"],
  attendance: ["attendance", "roll", "roll call", "rollcall", "register", "present", "absent", "presence", "presentvoting", "left the room", "arrived late", "is late", "came back", "came in late"],
  absent: ["absent", "not here", "missing"],
  participation: ["participation", "points", "point", "score", "scores", "scoring", "scored", "credit", "credits", "marks", "contribution", "contributions", "leaderboard"],
  speech: ["speech", "speeches", "speaker", "speakers", "speaking", "speak", "spoke", "floor"],
  poi: ["poi", "pois", "point of information", "points of information"],
  queue: ["queue", "queued", "next speaker", "speakers list", "speaker list"],
  debate: ["debate", "debating", "debated", "open debate", "start debate", "introduce"],
  vote: ["vote", "votes", "voting", "voted", "ballot", "ballots", "outcome", "result", "results", "veto", "abstain", "abstained", "abstention", "abstentions", "divide the house"],
  approve: ["approve", "approves", "approval", "approved", "approving", "review", "reviews", "reviewing", "inbox", "request changes", "changes requested", "feedback"],
  submit: ["submit", "submitted", "submitting", "submission", "submissions", "send", "sent"],
  resubmit: ["resubmit", "resubmitted", "resubmitting", "resubmission", "changes requested", "sent back", "send back"],
  print: ["print", "prints", "printed", "printing", "copies", "copy", "printer"],
  timer: ["timer", "clock", "countdown", "speaking time"],
  session: ["session", "sessions", "current session", "schedule"],
  award: ["award", "awards", "best delegate", "winner", "winners", "ranking", "rank"],
  photo: ["photo", "photos", "group photo", "picture", "pictures"],
  save: ["save", "saved", "saving", "sync", "synced", "syncing", "stuck", "waiting to sync", "waiting to send", "changes pending", "pending changes", "not saving", "arent saving", "sync strip", "saved on this device"],
  offline: ["offline", "wifi", "wi fi", "internet", "connection", "network", "signal", "disconnected", "no connection"],
  slow: ["slow", "lag", "laggy", "loading", "takes ages", "taking long"],
  conflict: ["conflict", "conflicts", "another chair", "someone else", "updated this item", "changed by", "record changed", "review needed"],
  error: ["error", "errors", "failed", "failing", "broken", "crash", "crashed", "red", "yellow", "green", "health", "not working", "doesnt work", "wont work"],
  mistake: ["wrong", "mistake", "mistakenly", "accidentally", "accident", "oops", "undo", "fix", "correct", "correction", "incorrect", "remove", "delete", "by mistake", "edit", "edited"],
  deduct: ["deduct", "deduction", "deductions", "penalty", "penalise", "penalize", "take away", "take off", "adjust points", "adjustment", "adjustments", "restore"],
  cant: ["cant", "cannot", "can not", "unable", "wont", "doesnt let", "not allowed", "disabled", "greyed", "grayed", "blocked", "why not", "wont let"],
  how: ["how", "how do", "how can", "how to", "steps", "guide", "explain", "where", "which page", "find"],
  next: ["what next", "whats next", "what is next", "next step", "next steps", "what should i do", "what do i do", "what now", "to do", "todo", "anything left", "anything pending", "whats pending", "anything waiting", "whats waiting", "waiting for me", "for me to do", "pending for me", "remind me", "reminders", "needs attention", "need attention", "needs my attention", "status update", "overview", "summary", "catch me up"],
  access: ["access", "access code", "access codes", "code", "codes", "password", "login", "log in", "sign in", "rotate", "revoke", "redeem"],
  share: ["share", "shared", "sharing", "anyone with the link", "editor", "permission", "permissions", "cant open", "wont open", "request access"],
  file: ["pdf", "pdfs", "word", "docx", "file", "files", "upload", "uploaded", "uploading", "attachment", "attach"],
  history: ["history", "earlier", "previous", "passed", "decisions"],
  delegate: ["delegate", "delegates", "delegation", "delegations", "country", "countries"],
  committee: ["committee", "committees"],
  school: ["school", "schools"],
  staff: ["staff", "chairs", "chair contact", "contacts", "reassign", "reassigning", "assign a chair", "add a chair", "edit a chair", "remove a chair", "chair emails"],
  import: ["import", "csv", "spreadsheet", "upload delegates"],
  link: ["link", "links", "qr", "qr code", "qr codes"],
  audit: ["audit", "audit log", "change history", "who changed", "activity trail"],
  scoringConfig: ["point values", "speech values", "poi values", "configure points", "configure scoring", "change values", "scoring settings"],
  overviewStatus: ["resolution status", "status overview", "all committees", "every committee", "across committees"],
  submitter: ["submitter", "submitters", "main submitter", "co submitter", "cosubmitter", "yield", "yielded", "yielding"],
  notices: ["notification", "notifications", "notice", "notices", "alert", "alerts", "popup", "popups", "pop up", "unread", "badge", "felix inbox", "my inbox", "messages"],
  motion: ["animation", "animations", "animate", "animated", "motion", "blink", "blinking", "moving", "wiggle"],
  human: ["human", "real person", "contact the executive", "message the executive", "talk to the executive", "talk to someone"],
  capabilities: ["what can you do", "what do you do", "what can i ask", "what can you help with", "what do you know"],
} as const;
export type Concept = keyof typeof CONCEPTS;

const TYPOS: Record<string, string> = {
  resolutoin: "resolution", resoultion: "resolution", reslution: "resolution", resolutin: "resolution", rezolution: "resolution",
  ammendment: "amendment", amendmant: "amendment", ammendmant: "amendment", admendment: "amendment", amendement: "amendment",
  attendence: "attendance", atendance: "attendance", attendace: "attendance", absnet: "absent", abesnt: "absent", absant: "absent",
  aprove: "approve", approove: "approve", apporve: "approve", aproval: "approval", approvel: "approval",
  partcipation: "participation", particpation: "participation", participaton: "participation", pionts: "points", ponits: "points",
  speach: "speech", speeh: "speech", debte: "debate", debat: "debate", priting: "printing", pritn: "print", saveing: "saving",
  synching: "syncing", synch: "sync", ofline: "offline", conflcit: "conflict", confict: "conflict", notifcation: "notification",
};

/** Lower-cases, strips accents and punctuation, expands contractions and fixes known typos. */
export function normalise(input: string): string {
  return input
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map(word => TYPOS[word] ?? word)
    .join(" ")
    // “Present & Voting” is an attendance status, not a vote.
    .replace(/\bpresent (and )?voting\b/g, "presentvoting");
}

/** Levenshtein distance, capped for speed. */
function distance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, row[j]);
    }
    if (best > cap) return cap + 1;
    prev = row;
  }
  return prev[b.length];
}

/** Common words that look like typos of vocabulary words but are not ("chair" is not "chairs" the staff topic). */
const NEUTRAL = ["chair", "other", "where", "there", "these", "those", "about", "would", "could", "should", "their", "point", "pending", "sending", "ending", "waiting", "printer", "words", "worded", "wording", "notes", "rotation", "felix", "hello"];
const VOCABULARY = new Set<string>([...Object.values(CONCEPTS).flat().filter(term => !term.includes(" ")), ...NEUTRAL]);

/** A word matches a vocabulary word exactly, or with one edit (two for words of eight letters or more). Real
 *  vocabulary words never fuzzy-match a different term ("point" is not a typo of "print"). */
function fuzzyWord(word: string, target: string): boolean {
  if (word === target) return true;
  if (VOCABULARY.has(word) || target.length < 5 || word.length < 5) return false;
  const cap = target.length >= 8 ? 2 : 1;
  return distance(word, target, cap) <= cap;
}

/** The set of concepts a question mentions. */
export function conceptsIn(question: string): Set<Concept> {
  const text = ` ${normalise(question)} `;
  const words = text.trim().split(" ");
  const found = new Set<Concept>();
  for (const [concept, terms] of Object.entries(CONCEPTS) as [Concept, readonly string[]][]) {
    for (const term of terms) {
      const matched = term.includes(" ") ? text.includes(` ${term} `) : words.some(word => fuzzyWord(word, term));
      if (matched) { found.add(concept); break; }
    }
  }
  return found;
}

export type Matchable = {
  id: string;
  /** Every concept listed must be present. */
  all: readonly Concept[];
  /** Optional concepts that make this intent a better fit. */
  any?: readonly Concept[];
  /** If any of these is present this intent is not a fit. */
  none?: readonly Concept[];
  /** Ties within a "family" are not ambiguous (they are variants of one topic). */
  family?: string;
};

export type MatchResult<T extends Matchable> =
  | { kind: "match"; intent: T; score: number }
  | { kind: "ambiguous"; options: T[] }
  | { kind: "none" };

/**
 * Scores intents: each required concept is worth 10 (so more specific intents outrank generic ones), each optional
 * concept 3. An intent must match all of its required concepts. Equal top scores across different families are
 * ambiguous.
 */
export function matchIntent<T extends Matchable>(question: string, intents: readonly T[]): MatchResult<T> {
  const found = conceptsIn(question);
  const scored = intents
    .filter(intent => intent.all.length > 0 && intent.all.every(c => found.has(c)) && !(intent.none ?? []).some(c => found.has(c)))
    .map(intent => ({ intent, score: intent.all.length * 10 + (intent.any ?? []).filter(c => found.has(c)).length * 3 }))
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { kind: "none" };
  const top = scored.filter(item => item.score === scored[0].score);
  const families = new Set(top.map(item => item.intent.family ?? item.intent.id));
  if (families.size > 1) return { kind: "ambiguous", options: top.map(item => item.intent) };
  return { kind: "match", intent: scored[0].intent, score: scored[0].score };
}
