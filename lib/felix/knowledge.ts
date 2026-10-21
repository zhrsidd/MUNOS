/**
 * Felix's knowledge base. Every answer describes behaviour that exists in DCMUN Conference OS today: button labels,
 * page names and messages are quoted from the app (reviewed 20 October 2026, see docs/FELIX.md). Keep it in step
 * with the UI; tests check every link against the real workspace navigation. Answers are per role; a role without
 * an answer is told which workspace does that job.
 */
import type { Role } from "../domain";
import { STAFF_ROLE_LABELS } from "../access";
import { MAIN_SUBMITTER_POINTS } from "../scoring";
import { TIMER_DURATIONS, DEFAULT_DURATION } from "../timer/local-timer";
import type { Matchable } from "./match";
import { felixResolutionLabel, type FelixContext } from "./context";

export type Answer = { text: string; steps?: string[]; mistakes?: string; href?: string; linkLabel?: string };
type AnswerFor = Answer | ((ctx: FelixContext) => Answer);
export type Entry = Matchable & {
  /** Short label used when Felix asks which topic was meant. */
  title: string;
  /** Example phrasings (documentation and tests). */
  examples: string[];
  answers: Partial<Record<Role, AnswerFor>>;
};

const HEALTH = (role: Role) => `/${role}/health`;
const durations = TIMER_DURATIONS.join("/");

const resolutionLifecycle = "Resolutions move Draft → Submitted → Review → Approved → Printed → In Debate → Closed. Chairs submit, the Approval Panel reviews and approves (or requests changes), Admins print, then the Chair opens debate and records the vote.";
const shareSteps = "In Google Docs: Share → General access → Anyone with the link → Editor. If a school blocks link sharing, share directly with an assigned Chair as an Editor.";
const askExecutive = "Access codes come from the Executive. Enter yours on the staff access screen (“Open staff workspace”). If it stops working, ask the Executive: they can rotate or revoke codes. Felix can’t see or change codes.";

export const KNOWLEDGE: Entry[] = [
  // ------------------------------------------------------------------ Roll call
  {
    id: "attendance-fix", family: "attendance", title: "Correct a roll-call mark",
    all: ["attendance", "mistake"], any: ["absent", "delegate"],
    examples: ["I marked the wrong delegate absent", "how do I fix attendance", "undo absent"],
    answers: {
      chair: {
        text: "Roll-call marks can be corrected at any time: the record is updated in place.",
        steps: ["Open Roll call (it uses the current session).", "Find the delegation and press the correct status: Present, Present & Voting or Absent. The selected one shows a ✓."],
        mistakes: "Marking someone Absent removes their speaker-queue entries and their vote in this session on resolutions not yet closed. Present & Voting removes any abstention. Switching back does not restore those: queue them again on Debate and record their vote again in Voting if needed.",
        href: "/chair/roll-call", linkLabel: "Open Roll call",
      },
    },
  },
  {
    id: "attendance-how", family: "attendance", title: "Take roll call",
    all: ["attendance"], any: ["how", "session", "delegate"],
    examples: ["how do I take roll call", "where is attendance", "mark delegates present"],
    answers: {
      chair: ctx => ({
        text: ctx.chair?.sessionName ? `Roll call for ${ctx.chair.sessionName}: ${ctx.chair.marked} of ${ctx.chair.delegates} delegations marked, ${ctx.chair.present} present.` : "First choose the committee’s current session in the “Current session” selector above the Chair pages.",
        steps: ["Choose the current session in the “Current session” selector.", "Open Roll call and press Present, Present & Voting or Absent for each delegation.", "Only delegates who are not Absent can be queued to speak or vote. Present & Voting delegates cannot abstain."],
        href: "/chair/roll-call", linkLabel: "Open Roll call",
      }),
    },
  },
  // ------------------------------------------------------------------ Participation
  {
    id: "points-deduct", family: "points", title: "Deduct or restore points",
    all: ["deduct"], any: ["participation", "delegate", "how"],
    examples: ["how do I deduct points", "give a penalty", "restore deducted points"],
    answers: {
      chair: {
        text: "Deductions are recorded separately: original scores are never changed.",
        steps: ["Open Participation.", "Press “Adjust points…” on the delegation’s row and give the amount and reason.", "Point adjustments, further down the page, lists every deduction and lets you restore one."],
        mistakes: "Deductions change points, not contributions: the contribution count stays the same.",
        href: "/chair/participation", linkLabel: "Open Participation",
      },
    },
  },
  {
    id: "points-fix", family: "points", title: "Correct participation points",
    all: ["participation", "mistake"], any: ["speech", "poi", "delegate"], none: ["deduct"],
    examples: ["I gave the wrong points", "undo a speech score", "edit participation"],
    answers: {
      chair: {
        text: "Recorded points are corrected in Participation; edits keep the event and add an audit entry.",
        steps: ["Open Participation and find the entry in Event history.", "Press Edit to choose a different configured value, or Undo to void it."],
        mistakes: "On Debate, “Speech recorded” means the speech already has a score: correct it in Participation instead of scoring again.",
        href: "/chair/participation", linkLabel: "Open Participation",
      },
    },
  },
  {
    id: "points-speech", family: "points", title: "Score a speech",
    all: ["participation", "speech"], any: ["how", "debate"], none: ["mistake", "deduct", "poi"],
    examples: ["how do I give speech points", "score a speech", "speech points"],
    answers: {
      chair: {
        text: "Speech points are recorded on the Debate page while the speech has the floor.",
        steps: ["Recognize the speaker with “Next speaker · <country>” (or “Invite Main Submitter”).", "Under “Record this speech”, press the configured value (+1, +2 or +3 unless the Executive changed them).", "Press “Finish · return floor to Chair” when the speech ends."],
        mistakes: `Scoring the Main Submitter’s speech also credits Main Submitter +${MAIN_SUBMITTER_POINTS}, once per resolution. To fix a score afterwards, use Participation → Event history → Edit.`,
        href: "/chair", linkLabel: "Open Debate",
      },
    },
  },
  {
    id: "points-general", family: "points", title: "Contributions and points",
    all: ["participation"], any: ["how", "delegate"], none: ["mistake", "speech", "vote", "scoringConfig", "deduct", "poi", "award"],
    examples: ["participation points", "where do I see participation", "contributions vs points"],
    answers: {
      chair: {
        text: "Contributions and points are counted separately. A contribution is each recorded speech, POI or other event (once, whatever its points); the automatic Main Submitter credit and point adjustments are not contributions. Points are the net total including deductions.",
        steps: ["Participation → Quick entry lists delegations by conference-wide contributions, most first. Select a delegate, then press a point value.", "The figures at the top are for the current session.", "Debate shows a conference-total points list for every delegation in the committee."],
        mistakes: "Speech and POI points are normally recorded from the Debate page during the speech.",
        href: "/chair/participation", linkLabel: "Open Participation",
      },
      admin: { text: `Point values are set in Operations → Scoring: Speech and POI values, with optional per-committee overrides. Main Submitter is fixed at +${MAIN_SUBMITTER_POINTS}.`, href: "/admin/scoring", linkLabel: "Open Scoring" },
    },
  },
  {
    id: "scoring-config", title: "Configure point values",
    all: ["scoringConfig"], any: ["how", "participation", "speech", "poi"],
    examples: ["change speech values", "configure scoring"],
    answers: {
      admin: { text: `Operations → Scoring sets the conference defaults, with optional per-committee overrides. Each category takes 1–10 whole-number values from 0 to 20; Main Submitter is fixed at +${MAIN_SUBMITTER_POINTS}. Past events keep their original points.`, href: "/admin/scoring", linkLabel: "Open Scoring" },
    },
  },
  {
    id: "award", title: "Awards",
    all: ["award"],
    examples: ["who should win best delegate", "how are awards decided"],
    answers: {
      chair: { text: "Conference OS does not rank delegates or score awards: awards remain the Chairs’ judgement. Participation shows each delegation’s contributions and points if you want them for reference.", href: "/chair/participation", linkLabel: "Open Participation" },
      admin: { text: "Conference OS does not rank delegates or score awards: awards remain the Chairs’ judgement. Scoring only sets participation point values.", href: "/admin/scoring", linkLabel: "Open Scoring" },
    },
  },
  // ------------------------------------------------------------------ Debate
  {
    id: "poi", title: "Points of information",
    all: ["poi"], any: ["how", "participation", "speech"],
    examples: ["how do POIs work", "POI allowance", "score a POI"],
    answers: {
      chair: {
        text: "POIs run in the Points of information panel on Debate while a speech has the floor.",
        steps: ["Under “POIs accepted by the speaker”, choose None, 1, 2, 3, Any, or set a Custom total.", "Add raised placards with “Add to POI queue”.", "Press “Next POI · <country>” to give them the floor (this records nothing).", "After the question, press its configured value (+1 or +2 by default), or “Withdraw POI”."],
        mistakes: "“Set or extend the allowance before recognizing another POI.” means the allowance is used up: use “Extend POIs +1”. A speaker cannot ask their own POI.",
        href: "/chair", linkLabel: "Open Debate",
      },
    },
  },
  {
    id: "queue", title: "Speaker queue",
    all: ["queue"], any: ["speech", "how", "debate"], none: ["print"],
    examples: ["how do I call the next speaker", "add someone to the speakers list", "reorder the queue"],
    answers: {
      chair: {
        text: "The speaker queue is on the Debate page.",
        steps: ["Under Debate order choose Open debate (one queue) or Closed debate (For and Against queues, with a Current phase).", "Pick a present delegate under “Add delegate” and press “+ Queue”. Reorder by dragging or with ↑/↓; remove with ×.", "Press “Next speaker · <country>” to recognize position 1 of the active queue."],
        mistakes: "Only the first speaker can be recognized: reorder the queue to call someone else. Only delegates not marked Absent in Roll call can be added.",
        href: "/chair", linkLabel: "Open Debate",
      },
    },
  },
  {
    id: "submitter", title: "Main Submitter and yields",
    all: ["submitter"], any: ["how", "speech", "debate", "participation", "cant"],
    examples: ["invite the main submitter", "yield to co-submitter"],
    answers: {
      chair: {
        text: "With a resolution in debate (and no amendment debate open), press “Invite Main Submitter · <country>” on Debate. During that speech, choose a delegate under “Yield to a Co-Submitter” and press “Yield floor”; the Co-Submitter then returns the floor to the Chair.",
        mistakes: `Scoring the Main Submitter’s speech also credits Main Submitter +${MAIN_SUBMITTER_POINTS}, once per resolution. The button reads “(mark present first)” until the Main Submitter is marked present in Roll call. Main Submitter and Co-Submitter speeches are not available during an amendment debate.`,
        href: "/chair", linkLabel: "Open Debate",
      },
    },
  },
  {
    id: "speech-general", title: "Speeches and the floor",
    all: ["speech"], any: ["how", "debate"], none: ["participation", "queue", "poi", "submitter", "mistake", "timer"],
    examples: ["who has the floor", "how do speeches work"],
    answers: {
      chair: ctx => ({
        text: `${ctx.chair?.speaking ? "A speaker has the floor right now." : "The floor is with the Chair."} Speeches run on Debate: recognize the first queued delegate with “Next speaker”, score the speech under “Record this speech”, then press “Finish · return floor to Chair”.`,
        mistakes: "Starting an amendment debate, or passing or failing one, needs the floor back with the Chair: finish the current speech first.",
        href: "/chair", linkLabel: "Open Debate",
      }),
    },
  },
  {
    id: "timer", title: "Speaker timer",
    all: ["timer"],
    examples: ["how does the timer work"],
    answers: {
      chair: { text: `The speaker timer is on Debate and runs on this device only (it is not saved to the conference or shown on other screens): ▶ Start timer, Ⅱ Pause, ↻ Reset, and ${durations} second durations (${DEFAULT_DURATION} by default). Starting or finishing a speech resets it.`, href: "/chair", linkLabel: "Open Debate" },
    },
  },
  {
    id: "debate-cant", family: "debate", title: "Why a resolution can’t be debated",
    all: ["debate", "cant"], any: ["resolution"], none: ["amendment"],
    examples: ["why can't I debate this resolution", "open debate is greyed out"],
    answers: {
      chair: ctx => {
        const notReady = ctx.documents.filter(d => ["Draft", "Submitted", "Review", "Approved"].includes(d.status)).slice(0, 3).map(d => `${felixResolutionLabel(ctx, d)} is ${d.status}`);
        return {
          text: `A resolution can be opened for debate only once it is Printed, and only one resolution per committee can be In Debate at a time.${ctx.chair?.inDebate ? ` ${ctx.chair.inDebate} is in debate now: close its vote first.` : ""}${notReady.length ? ` In your committee: ${notReady.join("; ")}.` : ""}`,
          steps: ["Draft → “Submit for review” (or “Submit to Approval” for a delegate submission).", "The Approval Panel approves it; Admins print it and mark it printed.", "On Resolutions, the Printed resolution shows “Open debate”."],
          mistakes: "“Close the current debate before opening another resolution.” means another resolution is still In Debate: finish its vote in Voting first.",
          href: "/chair/documents", linkLabel: "Open Resolutions",
        };
      },
    },
  },
  {
    id: "debate-how", family: "debate", title: "Run debate",
    all: ["debate"], any: ["how", "resolution", "session"],
    examples: ["how do I start debate", "open debate on a resolution"],
    answers: {
      chair: {
        text: "Open debate from Resolutions, then run it from the Debate page.",
        steps: ["Make sure the current session is selected and roll call is taken.", "Resolutions: on a Printed resolution press “Open debate”.", "Debate: choose Open or Closed debate, queue speakers, recognize them with “Next speaker”, score speeches and run POIs.", "When debate ends, use “Go to voting” and record the vote in Voting."],
        href: "/chair/documents", linkLabel: "Open Resolutions",
      },
    },
  },
  // ------------------------------------------------------------------ Resolutions and Google Docs
  {
    id: "resolution-file", family: "resolution", title: "PDF or Word files",
    all: ["file"], any: ["resolution", "submit", "cant", "how"], none: ["import"],
    examples: ["can delegates upload a PDF", "a delegate has a Word file", "upload a resolution file"],
    answers: {
      chair: {
        text: "New resolutions are submitted as Google Docs links only: PDF and Word files are not accepted, and the submission form has no file upload. Files uploaded before this rule stay readable by staff with “Open uploaded file”.",
        steps: ["A delegate with a Word file opens it in Google Docs and chooses File → Save as Google Docs.", shareSteps, "They submit the link from Share → Copy link on the committee QR form."],
        href: "/chair/documents", linkLabel: "Open Resolutions",
      },
      approval: { text: "New resolutions arrive as Google Docs, not files: open the approval copy or working Google Doc from the Review inbox. Files uploaded before the Docs-only rule stay readable with “Open uploaded file”.", href: "/approval", linkLabel: "Open Review inbox" },
      logistics: { text: "New resolutions are Google Docs, not files: print from “Open approval copy” or “Open working Google Doc” on each job. Older uploaded files stay readable with “Open uploaded file”.", href: "/logistics", linkLabel: "Open Print queue" },
      admin: { text: "New resolutions are Google Docs links only; the public form refuses files. Operations → Resolution links manages each committee’s QR link.", href: "/admin/submissions", linkLabel: "Open Resolution links" },
    },
  },
  {
    id: "resolution-access", family: "resolution", title: "Google Doc won’t open",
    all: ["share"], any: ["resolution", "cant", "link", "access"], none: ["amendment", "vote"],
    examples: ["I can't open the google doc", "how should delegates share their doc", "anyone with the link"],
    answers: {
      chair: {
        text: `Delegates must let Chairs edit the Doc. ${shareSteps}`,
        steps: ["If you can’t open a submitted Doc, press “Can’t access” on its card (Submit to Approval stays disabled while it is marked).", "Ask the delegation to fix the sharing, open the Doc again, then press “Access fixed”."],
        mistakes: "Conference OS stores only the Doc’s link, never its text, and cannot check sharing for you.",
        href: "/chair/documents", linkLabel: "Open Resolutions",
      },
      approval: { text: "If an approval copy or working Doc won’t open, tell the committee’s Chair: Chairs ask delegations to share with Anyone with the link → Editor, or directly with a Chair.", href: "/approval", linkLabel: "Open Review inbox" },
      logistics: { text: "If a document won’t open for printing, tell the committee’s Chair or the Executive. Docs are shared by delegations with Anyone with the link → Editor, or directly with a Chair.", href: "/logistics", linkLabel: "Open Print queue" },
    },
  },
  {
    id: "resolution-submit", family: "resolution", title: "Submit a resolution to Approval",
    all: ["submit"], any: ["resolution", "how", "cant", "approve"], none: ["amendment", "link", "submitter", "file", "share"],
    examples: ["how do I submit a resolution", "why can't I submit to approval", "delegate submissions"],
    answers: {
      chair: {
        text: "Submitting sends a resolution to the Approval Panel’s Review inbox.",
        steps: ["Delegate submissions appear at the top of Resolutions: “Open Google Doc”, review and edit it there, optionally paste your Approval-folder copy, then press “Submit to Approval”.", "For a draft you created with “+ New resolution”, press “Submit for review”."],
        mistakes: "“Submit to Approval” stays disabled while the card is marked “Can’t access”: get the sharing fixed, then press “Access fixed”.",
        href: "/chair/documents", linkLabel: "Open Resolutions",
      },
    },
  },
  {
    id: "changes-requested", family: "approve", title: "Changes requested",
    all: ["resubmit"], any: ["approve", "resolution", "how", "cant"], none: ["amendment", "file", "share"],
    examples: ["resubmit after changes requested", "how do I resubmit"],
    answers: {
      chair: { text: "When the Approval Panel requests changes, the resolution returns to you as Draft with a “Changes requested” label and the feedback shown in full. Edit the Google Doc, then press “Resubmit after editing →”. Earlier feedback and the Approval history stay on the row.", href: "/chair/documents", linkLabel: "Open Resolutions" },
      approval: { text: "Resubmitted resolutions come back into your Review inbox as Submitted, with earlier decisions under “Decisions on this resolution”.", href: "/approval", linkLabel: "Open Review inbox" },
    },
  },
  {
    id: "approve", family: "approve", title: "Review and approve resolutions",
    all: ["approve"], any: ["resolution", "how"], none: ["history"],
    examples: ["where do I approve documents", "how do I request changes", "review inbox"],
    answers: {
      approval: ctx => {
        const waiting = ctx.documents.filter(d => d.status === "Submitted" || d.status === "Review").length;
        return {
          text: `${waiting ? `${waiting} resolution${waiting === 1 ? " is" : "s are"} in your Review inbox. ` : "Your Review inbox is clear right now. "}Reviews happen in the Review inbox.`,
          steps: ["Select a submission (“Review submission →”) and, if it is Submitted, press “Start review”.", "Read the approval copy or working Google Doc.", "Press “✓ Approve resolution” (it goes to the print queue), or write a Review comment and press “↶ Request changes” (it returns to the Chair as Draft)."],
          mistakes: "Requesting changes needs a comment: “Add a comment so the chair knows what to change.”",
          href: "/approval", linkLabel: "Open Review inbox",
        };
      },
      chair: { text: "Approval is done by the Approval Panel in their Review inbox. You submit resolutions and follow their status on Resolutions; a request for changes returns them to you as Draft with the feedback.", href: "/chair/documents", linkLabel: "Open Resolutions" },
      admin: { text: "The Approval Panel reviews in its own workspace. Operations → Resolution status shows every resolution’s approval, printing and debate progress across committees, with the latest feedback. It is read-only.", href: "/admin/resolution-status", linkLabel: "Open Resolution status" },
    },
  },
  {
    id: "approval-history", family: "approve", title: "Approval history",
    all: ["approve", "history"], any: ["resolution", "how"],
    examples: ["approval history", "see earlier review decisions"],
    answers: {
      approval: { text: "History lists every decision on every resolution, newest first, with the version and review round it applied to.", href: "/approval/history", linkLabel: "Open History" },
      chair: { text: "Each resolution on Resolutions has “Approval history” and “Earlier feedback” you can expand.", href: "/chair/documents", linkLabel: "Open Resolutions" },
      admin: { text: "Resolution status shows the latest feedback and an expandable Approval history for each resolution.", href: "/admin/resolution-status", linkLabel: "Open Resolution status" },
    },
  },
  {
    id: "print", title: "Printing",
    all: ["print"], any: ["resolution", "how", "approve"],
    examples: ["how do I mark printed", "how many copies", "print queue"],
    answers: {
      logistics: ctx => {
        const queue = ctx.documents.filter(d => d.status === "Approved");
        return {
          text: `${queue.length ? `${queue.length} approved resolution${queue.length === 1 ? " is" : "s are"} in the print queue, ${queue.reduce((n, d) => n + d.copies, 0)} copies in total. ` : "The print queue is empty right now. "}Only approved resolutions enter it. Each job's copies are one per committee delegate plus 3 spares, counted when the resolution is approved.`,
          steps: ["Open the approved version with “Open approval copy ↗” (or the working Google Doc) and print it.", "Print the number of copies shown on the job.", "Press “✓ Mark printed” so the Chair can open debate. Printed jobs move to Completed."],
          href: "/logistics", linkLabel: "Open Print queue",
        };
      },
      chair: { text: "Admins print approved resolutions and mark them printed. Once a resolution shows Printed on Resolutions you can open debate.", href: "/chair/documents", linkLabel: "Open Resolutions" },
      approval: { text: "When you approve a resolution it moves to the Admins’ print queue; they mark it printed, then the Chair can open debate.", href: "/approval", linkLabel: "Open Review inbox" },
      admin: { text: "Resolution status shows each resolution’s printing stage across committees.", href: "/admin/resolution-status", linkLabel: "Open Resolution status" },
    },
  },
  {
    id: "resolution-general", family: "resolution", title: "Resolutions",
    all: ["resolution"], any: ["how"], none: ["submit", "resubmit", "approve", "print", "debate", "vote", "amendment", "cant", "file", "share", "overviewStatus"],
    examples: ["where are resolutions", "resolution workflow"],
    answers: {
      chair: { text: `Resolutions holds your committee’s resolutions and delegate submissions, needing-you items first. ${resolutionLifecycle}`, href: "/chair/documents", linkLabel: "Open Resolutions" },
      approval: { text: `Your Review inbox lists Submitted and Review resolutions. ${resolutionLifecycle}`, href: "/approval", linkLabel: "Open Review inbox" },
      logistics: { text: `Approved resolutions appear in your print queue. ${resolutionLifecycle}`, href: "/logistics", linkLabel: "Open Print queue" },
      admin: { text: `Resolution status shows every committee’s resolutions with their approval, printing and debate progress. ${resolutionLifecycle}`, href: "/admin/resolution-status", linkLabel: "Open Resolution status" },
    },
  },
  {
    id: "resolution-status", title: "Resolution status across committees",
    all: ["overviewStatus"], any: ["resolution"],
    examples: ["resolution status across committees"],
    answers: {
      admin: { text: "Operations → Resolution status lists each committee’s resolutions with their approval, printing and debate progress and latest feedback. It is read-only; decisions stay in their workspaces.", href: "/admin/resolution-status", linkLabel: "Open Resolution status" },
      chair: { text: `Resolutions shows the status of each of your committee’s resolutions. ${resolutionLifecycle}`, href: "/chair/documents", linkLabel: "Open Resolutions" },
      approval: { text: "Your Review inbox lists the resolutions waiting for review; after approval they move to the Admins’ print queue.", href: "/approval", linkLabel: "Open Review inbox" },
      logistics: { text: "Your print queue lists approved resolutions waiting to print; Completed shows what has been printed.", href: "/logistics", linkLabel: "Open Print queue" },
    },
  },
  // ------------------------------------------------------------------ Amendments
  {
    id: "amendment-history", family: "amendment", title: "Passed amendments",
    all: ["amendment", "history"],
    examples: ["passed amendments history", "where are earlier amendments"],
    answers: {
      chair: { text: "Amendments → Passed amendments keeps every passed amendment for your committee, grouped by resolution, after debate ends. Each has “Copy wording”, with “Open working Google Doc” for its resolution. The time shown is when it was submitted.", href: "/chair/amendments", linkLabel: "Open Amendments" },
    },
  },
  {
    id: "amendment-cant", family: "amendment", title: "Why an amendment can’t start",
    all: ["amendment", "cant"],
    examples: ["why can't I start the amendment debate"],
    answers: {
      chair: {
        text: "An amendment debate can start only while its resolution is In Debate, when no other amendment is In Debate, and when the floor is with the Chair.",
        mistakes: "If a speech or its POIs still hold the floor, press “Finish · return floor to Chair” first. “Close the current amendment debate first.” means another amendment is In Debate.",
        href: "/chair/amendments", linkLabel: "Open Amendments",
      },
    },
  },
  {
    id: "amendment-how", family: "amendment", title: "Amendments",
    all: ["amendment"], any: ["how", "debate", "vote", "submit"],
    examples: ["how do amendments work", "accept an amendment"],
    answers: {
      chair: {
        text: "Delegates submit amendments through the committee’s amendment QR code while a resolution is in debate; they arrive in Amendments.",
        steps: ["Press “Accept for debate” (or “Rule out” / “Withdraw”).", "Press “Start amendment debate”: resolution debate pauses while the amendment has priority.", "On Debate, press “Pass amendment”, “Fail amendment” or “Withdraw” when the floor is with the Chair."],
        mistakes: "A passed amendment does not change the Google Doc: apply it to the working Google Doc by hand. Passed amendments stay listed under Passed amendments.",
        href: "/chair/amendments", linkLabel: "Open Amendments",
      },
      admin: { text: "Operations → Amendment links manages the QR links delegates use to submit amendments; Chairs review them in their committee.", href: "/admin/amendment-links", linkLabel: "Open Amendment links" },
    },
  },
  // ------------------------------------------------------------------ Voting
  {
    id: "vote-cant", family: "vote", title: "Why voting can’t be closed",
    all: ["vote", "cant"],
    examples: ["why can't I close voting", "abstain is disabled"],
    answers: {
      chair: {
        text: "“Close voting” is enabled only once every delegation not marked Absent has voted.",
        mistakes: "Present & Voting delegates cannot abstain, and Divide the House allows only For and Against. If a delegate left, correct their mark in Roll call (marking them Absent removes their vote in this session).",
        href: "/chair/voting", linkLabel: "Open Voting",
      },
    },
  },
  {
    id: "vote-how", family: "vote", title: "Voting",
    all: ["vote"], any: ["how", "resolution"],
    examples: ["how do I record votes", "divide the house"],
    answers: {
      chair: {
        text: "Voting records ballots for the resolution in debate; Conference OS never votes for delegates.",
        steps: ["Choose Normal vote or Divide the House, and a Vote type: Substantive or Procedural · no veto.", "Record For, Against or Abstain for each delegation not marked Absent.", "Press “Close voting”, then confirm the result."],
        mistakes: "Changing the procedure after ballots exist starts a fresh ballot (earlier choices stay in the audit history). On a substantive vote, an Against from a veto-capable delegation makes it fail.",
        href: "/chair/voting", linkLabel: "Open Voting",
      },
      admin: { text: "Veto delegations are configured per committee under Operations → Workflow & features (Committee voting rules). Veto applies to substantive votes only.", href: "/admin/workflow", linkLabel: "Open Workflow & features" },
    },
  },
  // ------------------------------------------------------------------ Sessions and photos
  {
    id: "session", title: "Sessions",
    all: ["session"], any: ["how"], none: ["offline", "save", "error", "conflict", "slow"],
    examples: ["how do I choose the session", "schedule sessions"],
    answers: {
      chair: ctx => ({ text: `${ctx.chair?.sessionName ? `The current session is ${ctx.chair.sessionName}. ` : ctx.chair && !ctx.chair.hasSessions ? "Your committee has no sessions yet: they come from the Executive’s central schedule. " : "No current session is selected. "}Choose it in the “Current session” selector above the Chair pages; it may suggest the session scheduled for now. Roll call, debate and voting use the current session.`, href: "/chair", linkLabel: "Open Debate" }),
      admin: { text: "Programme → Sessions holds one shared conference schedule. Each committee keeps its own attendance, debate and participation history for each session.", href: "/admin/sessions", linkLabel: "Open Sessions" },
    },
  },
  {
    id: "photo", title: "Group photos",
    all: ["photo"],
    examples: ["when is our group photo"],
    answers: {
      chair: { text: "More → Group photos lists your committee’s school photo slots. From the warning time (10 minutes before by default) a banner appears on every Chair page: press “Acknowledge”, and at the start time send the delegates listed and press “Delegates sent”.", href: "/chair/photos", linkLabel: "Open Group photos" },
      admin: { text: "Programme → Group photos is where school photo slots are scheduled or imported. Chairs of committees with delegates from that school get reminders.", href: "/admin/photos", linkLabel: "Open Group photos" },
    },
  },
  // ------------------------------------------------------------------ Access and Executive setup
  {
    id: "access", title: "Access codes",
    all: ["access"], none: ["share", "link"],
    examples: ["rotate an access code", "my access code stopped working"],
    answers: {
      admin: {
        text: "People → Access codes creates, rotates and revokes a code for each workspace scope. A new code is shown once: copy it and hand it over privately.",
        steps: ["Rotating blocks the previous code for new devices; devices already in keep access until expiry or revocation.", "Revoke stops new redemptions; tick “Also revoke devices using this code” to block those devices when they next check access (their saved changes stay on the device for recovery)."],
        mistakes: "Access-code actions need a live connection to the conference database: they are not saved on this device for later, and the local demo does not issue real codes.",
        href: "/admin/access-codes", linkLabel: "Open Access codes",
      },
      chair: { text: askExecutive },
      approval: { text: askExecutive },
      logistics: { text: askExecutive },
    },
  },
  {
    id: "delegates", title: "Delegates",
    all: ["delegate"], any: ["import", "how"], none: ["attendance", "participation", "vote", "queue", "speech", "submit", "award", "poi", "photo", "deduct", "file", "share"],
    examples: ["import delegates", "edit a delegate"],
    answers: {
      admin: { text: "People → Delegates: “↥ Import delegates” takes a spreadsheet (CSV) of delegates, and each delegate can be edited there.", href: "/admin/delegates", linkLabel: "Open Delegates" },
      chair: { text: "Delegations are managed by the Executive. In Roll call you can press a delegation for its contact details and participation history.", href: "/chair/roll-call", linkLabel: "Open Roll call" },
    },
  },
  { id: "committees", title: "Committees", all: ["committee"], any: ["how"], none: ["delegate", "resolution", "session"], examples: ["archive a committee"], answers: { admin: { text: "People → Committees edits committees and archives them. Archiving keeps all history; a committee with linked records cannot be deleted.", href: "/admin/committees", linkLabel: "Open Committees" } } },
  { id: "schools", title: "Schools", all: ["school"], none: ["photo"], examples: ["add a school"], answers: { admin: { text: "People → Schools manages the schools delegates belong to.", href: "/admin/schools", linkLabel: "Open Schools" } } },
  { id: "staff", title: "Chairs & staff", all: ["staff"], any: ["committee"], examples: ["reassign a chair"], answers: { admin: { text: "People → Chairs & staff is the staff directory with each person’s role and committees. Workspace access still comes from access codes.", href: "/admin/staff", linkLabel: "Open Chairs & staff" } } },
  { id: "links", title: "QR submission links", all: ["link"], any: ["resolution", "amendment"], none: ["share"], examples: ["resolution QR link"], answers: { admin: { text: "Operations → Resolution links manages each committee’s QR link for resolution submissions; Amendment links does the same for amendments.", href: "/admin/submissions", linkLabel: "Open Resolution links" }, chair: { text: "The committee’s resolution QR code is below the list on Resolutions, and the amendment QR code is at the top of Amendments.", href: "/chair/documents", linkLabel: "Open Resolutions" } } },
  { id: "audit", title: "Audit log", all: ["audit"], examples: ["who changed this"], answers: { admin: { text: "More → Audit log traces actions across every workspace.", href: "/admin/audit", linkLabel: "Open Audit log" } } },
  // ------------------------------------------------------------------ Felix itself (every role)
  felixEntry("notices"),
  felixEntry("motion"),
  // ------------------------------------------------------------------ Troubleshooting (every role)
  ...(["conflict", "save", "offline", "slow", "error"] as const).map(kind => troubleshooting(kind)),
];

function felixEntry(kind: "notices" | "motion"): Entry {
  const answer: Answer = kind === "notices"
    ? { text: "Felix’s Inbox (the Inbox tab in this panel) keeps every reminder Felix has shown you, with New marking ones you haven’t opened yet. Short notices also appear above the Felix button; closing one keeps it in the Inbox. Read state is stored in this browser only, and Felix never uses browser notifications, so blocked notification permissions don’t matter. Reminders come only from what this page has already loaded." }
    : { text: "Felix blinks now and then, moves his beak while you type to him and enjoys a pat when you hover. Turn this off with “Animate Felix” at the bottom of this panel (remembered on this device). Felix stays still whenever your device asks for reduced motion, the tab is hidden or the button is off screen. Felix’s face never shows save or sync status: the sync strip does." };
  return { id: `felix-${kind}`, family: "felix", title: kind === "notices" ? "Felix’s Inbox and notices" : "Felix’s animation", all: [kind], examples: kind === "notices" ? ["where are my notifications", "what do the popups mean"] : ["turn off the animation", "stop blinking"], answers: { chair: answer, approval: answer, logistics: answer, admin: answer } };
}

/** Executive access-code actions call the server directly: they are not queued and need a live connection. */
const CLOUD_ONLY = (role: Role) => role === "admin" ? " Access-code actions (create, rotate, revoke) are the exception: they go straight to the server, are not queued, and need a live connection." : "";

/** What reloads offline depends on the role: the service worker prepares a fixed list of pages (public/sw.js). */
function offlineScope(role: Role): string {
  const queued = `Ordinary conference actions on an open screen are saved on this device first and sent automatically, in order, when the connection returns.${CLOUD_ONLY(role)}`;
  if (role === "chair") return `Prepared Chair pages (Debate, Roll call, Resolutions, Amendments, Participation, Voting, Group photos and System health) can reload offline once this device has opened them online. ${queued}`;
  const own = role === "admin" ? "Resolution status and System health pages" : role === "approval" ? "History and System health pages" : "Completed and System health pages";
  const main = role === "approval" ? "Review inbox is" : role === "logistics" ? "Print queue is" : "other Executive pages are";
  return `Only the ${own} reliably reload offline for your role; the ${main} not prepared for offline reload, so don’t refresh or close it while offline: it needs a connection to reopen. ${queued}`;
}

/** Safe, state-aware troubleshooting. Never suggests clearing storage, repeated refreshes or bypassing conflicts. */
function troubleshooting(kind: "conflict" | "save" | "offline" | "slow" | "error"): Entry {
  const titles = { conflict: "Conflicting changes", save: "Saving and the sync strip", offline: "Offline or no connection", slow: "Slow connection", error: "System health colours and errors" };
  const examples = { conflict: ["another chair updated this item", "conflict"], save: ["my changes aren't saving", "what does saved on this device mean", "stuck syncing"], offline: ["the wifi is down", "I'm offline"], slow: ["it's really slow"], error: ["what does red mean", "something failed"] };
  const answer = (ctx: FelixContext): Answer => ({ ...healthAnswer(kind, ctx), href: HEALTH(ctx.role), linkLabel: "Open System health" });
  return { id: `health-${kind}`, family: "health", title: titles[kind], all: [kind], any: (["save", "error", "offline"] as const).filter(c => c !== kind), examples: examples[kind], answers: { chair: answer, approval: answer, logistics: answer, admin: answer } };
}

/** Explains the device's current health (from the store the sync strip already uses) without acting on it. */
export function healthAnswer(kind: string, ctx: FelixContext): Answer {
  const h = ctx.health;
  const keepOpen = "Keep this device and browser open; don’t clear browser data, sign out or switch devices while changes are waiting.";
  const now = !h ? "" : h.mode === "local" ? "This is the local demo: changes are saved in this browser only. " :
    h.conflicts ? `Right now ${h.conflicts} change${h.conflicts === 1 ? " needs" : "s need"} review. ` :
    h.state === "error" ? "Right now this device can’t save changes. " :
    h.state === "waiting" ? `Right now this device is waiting for a connection${h.pending ? ` with ${h.pending} change${h.pending === 1 ? "" : "s"} saved on this device` : ""}. ` :
    h.state === "syncing" && h.pending ? `Right now ${h.pending} change${h.pending === 1 ? " is" : "s are"} being sent. ` :
    h.latency !== null && h.latency > 3000 ? "Right now the connection is slow. " :
    h.state === "saved" && !h.pending ? "Right now everything is synced. " : "";
  const advice: Record<string, Answer> = {
    conflict: { text: `${now}A conflict means another device or tab changed the same item before your saved change reached the server. Your change is kept, and later changes wait behind it.`, steps: ["Open System health and read “Review saved … change”.", "Press “Export device recovery file” first.", "Check the current value in the conference. If your change is still needed, press “Keep conference value · dismiss exported action” and enter the change again."], mistakes: "Felix never retries, discards or edits saved changes for you." },
    save: { text: `${now}The sync strip under the navigation tells you where your work is. “Saved on this device” means it is stored safely on this device but not yet confirmed by the server; “All changes synced” means the server has it. “Waiting to send” and “Offline · N changes saved on this device” are safe and send automatically, in order, when the connection allows.${CLOUD_ONLY(ctx.role)} ${keepOpen}`, mistakes: "“Review needed” means a conflict: open System health. “This device cannot save changes” means stop recording on this device and contact the Executive." },
    offline: { text: `${now}${offlineScope(ctx.role)} ${keepOpen}`, mistakes: "Avoid refreshing repeatedly while changes are waiting. System health’s “Retry connection” checks the connection again; it does not discard anything." },
    slow: { text: `${now}A slow conference database (over 3 seconds) shows YELLOW: carry on. Ordinary conference actions still save on this device first and sync in order, so a slow network delays them but doesn’t lose them.${CLOUD_ONLY(ctx.role)} ${keepOpen}`, mistakes: "If a save seems to have failed, check System health and the current record before repeating it: a slow reply can hide a change that did go through." },
    error: { text: `${now}System health colours: GREEN carry on; YELLOW carry on, something is degraded and recovers automatically; RED stop recording on this device and contact the Executive.`, mistakes: "An error message does not prove the action failed: the server may have saved it even though the reply was lost. Before trying again, open System health and check for changes still pending or needing review, then check the current record on its page. Repeat the action only if the change is genuinely missing." },
  };
  return advice[kind] ?? advice.error;
}

/** Topics Felix can help a role with (shown when a question is unclear). */
export function topicsFor(role: Role): string[] {
  return KNOWLEDGE.filter(entry => entry.answers[role] && entry.family !== "health" && entry.family !== "felix").map(entry => entry.title).filter((title, i, all) => all.indexOf(title) === i);
}

export const roleLabel = (role: Role) => STAFF_ROLE_LABELS[role];
