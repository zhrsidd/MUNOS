/**
 * Felix's answers. Deterministic and local: the same question in the same app state always gets the same answer, and
 * nothing leaves the browser. Felix only describes and links; it never changes conference data. Replies are returned
 * immediately with no "thinking" delay; the panel types them out at lib/felix/reveal.ts pace.
 */
import type { Role } from "../domain";
import { destinationSlugs } from "../navigation";
import { conceptsIn, matchIntent, type Matchable } from "./match";
import { KNOWLEDGE, roleLabel, topicsFor, type Answer, type Entry } from "./knowledge";
import { formatReminders, type Reminder } from "./reminders";
import type { FelixContext } from "./context";

export type Reply = { text: string; href?: string; linkLabel?: string; intent?: string };

/** Every workspace route a role can reach from its navigation, as hrefs ("/chair", "/chair/roll-call", …). */
export function destinationHrefs(role: Role): string[] {
  return destinationSlugs(role).map(slug => (slug ? `/${role}/${slug}` : `/${role}`));
}

/** Only real navigation destinations inside the user's own workspace are ever linked. */
export function safeLink(role: Role, href?: string): string | undefined {
  return href && destinationHrefs(role).includes(href) ? href : undefined;
}

/** Stable choice among friendly variants (no randomness: the same words always get the same reply). */
function pick(options: string[], seed: string) {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return options[hash % options.length];
}

function render(role: Role, answer: Answer, intent: string): Reply {
  const parts = [answer.text];
  if (answer.steps?.length) parts.push(answer.steps.map((step, i) => `${i + 1}. ${step}`).join("\n"));
  if (answer.mistakes) parts.push(`Watch out: ${answer.mistakes}`);
  const href = safeLink(role, answer.href);
  return { text: parts.join("\n"), href, linkLabel: href ? answer.linkLabel : undefined, intent };
}

function smallTalk(question: string, role: Role): Reply | undefined {
  const q = question.toLowerCase().trim();
  if (/^(hi|hello|hey|hiya|yo|good morning|good afternoon|good evening)( felix)?[!. ]*$/.test(q)) return { text: pick(["Hello! Felix here. What can I help you find?", "Hi there! Need a hand finding something in MUNOS?", "Hello! Ask me what to do next, or how something works."], q), intent: "smalltalk" };
  if (/^(thanks|thank you|thx|cheers)( felix)?[!. ]*$/.test(q)) return { text: pick(["Any time! I’ll be right here if you need me.", "You’re welcome! Anything else you want to find?", "Happy to help. Good luck with the session!"], q), intent: "smalltalk" };
  if (/how are you|hows it going|how's it going|how are things/.test(q)) return { text: "All feathers in order, thank you! How can I help with your workspace?", intent: "smalltalk" };
  if (/who are you|your name|what are you\b/.test(q)) return { text: "I’m Felix, the Doha College mascot and your MUNOS helper. I can tell you what needs doing next, walk you through a workflow and help you recover safely when something goes wrong. I follow fixed rules, not AI: I only read what this page has already loaded and never change anything for you.", intent: "smalltalk" };
  if (/\bjoke\b|make me laugh/.test(q)) return { text: "Why did the Chair bring a ladder to committee? To help the debate reach new heights. Want help finding anything while we’re here?", intent: "smalltalk" };
  if (/\b(weather|music|movie|football|soccer|weekend|lunch|game)\b/.test(q)) return { text: `I’m happy to chat, but I don’t have news or opinions about that. I can help with your ${roleLabel(role)} workspace, though. What are you trying to do?`, intent: "smalltalk" };
  return undefined;
}

/** A one-line picture of where things stand, from already-loaded state. */
export function situation(ctx: FelixContext): string {
  const count = (...statuses: string[]) => ctx.documents.filter(d => statuses.includes(d.status)).length;
  if (ctx.role === "chair" && ctx.chair) {
    const c = ctx.chair;
    const roll = c.delegates === 0 ? "no delegates in this committee yet" : c.marked === 0 ? "no roll call yet" : `roll call ${c.present} of ${c.delegates} present`;
    return `${c.committeeCode ?? "Your committee"}${c.sessionName ? ` · ${c.sessionName}` : ""}: ${roll}; ${c.speaking ? "a speaker has the floor" : "the floor is with the Chair"}${c.queued ? `; ${c.queued} queued to speak` : ""}${c.inDebate ? `; ${c.inDebate} is in debate` : ""}.`;
  }
  if (ctx.role === "approval") return `Review inbox: ${count("Submitted")} waiting to start review, ${count("Review")} in review.`;
  if (ctx.role === "logistics") return `Print queue: ${count("Approved")} approved resolution${count("Approved") === 1 ? "" : "s"} waiting to print.`;
  if (!ctx.documents.length) return "No resolutions have been created yet.";
  return `Across committees: ${[["Draft", count("Draft")], ["with the Approval Panel", count("Submitted", "Review")], ["awaiting print", count("Approved")], ["printed", count("Printed")], ["in debate", count("In Debate")], ["closed", count("Closed")]].filter(([, n]) => n).map(([label, n]) => `${n} ${label}`).join(", ")}.`;
}

type NextEntry = Matchable & { filter?: (r: Reminder) => boolean };
const NEXT: NextEntry[] = [
  { id: "next-amendment", family: "next", all: ["next", "amendment"], filter: r => /amend/.test(r.key) },
  { id: "next-resolution", family: "next", all: ["next", "resolution"], filter: r => !/amend|sync|photo/.test(r.key) },
  { id: "next", family: "next", all: ["next"] },
];

function nextAnswer(ctx: FelixContext, reminders: Reminder[], filter?: (r: Reminder) => boolean): Reply {
  const relevant = filter ? reminders.filter(filter) : reminders;
  const status = situation(ctx);
  if (!relevant.length) return { text: `${status} Nothing needs your attention in what this workspace has loaded. New reminders will appear in Felix’s Inbox.`, intent: "next" };
  const first = relevant.find(r => r.priority !== "info") ?? relevant[0];
  const href = safeLink(ctx.role, first.href);
  return { text: `${status}\n${formatReminders(ctx.role, relevant)}`, href, linkLabel: href ? first.linkLabel : undefined, intent: "next" };
}

/** Answers one question for the current role using only loaded state. */
export function answerQuestion(question: string, ctx: FelixContext, reminders: Reminder[]): Reply {
  const role = ctx.role;
  const chat = smallTalk(question, role);
  if (chat) return chat;
  const found = conceptsIn(question);
  if (found.has("human")) return { text: "For a person, message the Executive through your conference’s usual contact channel. Felix doesn’t have contact details, so I won’t guess a number.", intent: "human" };
  if (found.has("capabilities")) return { text: `I can tell you what needs doing next, explain how to do something, and help you recover safely when something goes wrong. For the ${roleLabel(role)} workspace I know about: ${topicsFor(role).join(", ")}. I only read what this page has already loaded, and I never change anything for you.`, intent: "capabilities" };

  const all: (Entry | NextEntry)[] = [...NEXT, ...KNOWLEDGE];
  const result = matchIntent(question, all);
  if (result.kind === "ambiguous") {
    const titles = result.options.map(option => ("title" in option ? option.title : "What needs doing next")).filter((t, i, a) => a.indexOf(t) === i);
    return { text: `I want to be sure I point you the right way. Did you mean ${titles.slice(0, -1).join(", ")} or ${titles.at(-1)}? Ask again with a little more detail, for example “How do I …” or “Why can’t I …”.`, intent: "ambiguous" };
  }
  if (result.kind === "none") {
    return { text: `I’m not sure I understood that, and I’d rather not guess. In the ${roleLabel(role)} workspace I can help with: ${topicsFor(role).join(", ")}. You can also ask “What should I do next?” or describe what went wrong.`, intent: "fallback" };
  }
  const intent = result.intent;
  if (!("answers" in intent)) return { ...nextAnswer(ctx, reminders, intent.filter), intent: intent.id };
  const answer = intent.answers[role];
  if (!answer) {
    const owners = (Object.keys(intent.answers) as Role[]).map(roleLabel);
    return { text: `${intent.title} is handled in the ${owners.join(" or ")} workspace, not in your ${roleLabel(role)} workspace, so I can’t take you there. If you need it done, ask the people with that role or the Executive.`, intent: intent.id };
  }
  return render(role, typeof answer === "function" ? answer(ctx) : answer, intent.id);
}
