import test from "node:test";
import assert from "node:assert/strict";
import type { Reminder } from "../lib/felix/reminders";
import { InboxStore, MAX_INACTIVE, isNewSince, markPopped, markRead, mergeInbox, nextPopup, parseInbox, unreadCount, type InboxEntry } from "../lib/felix/inbox";
import { MAX_MESSAGES, MOTION_KEY, felixStorageKeys, parseMotionPreference, parseStoredChat } from "../lib/felix/storage";

const reminder = (key: string, priority: Reminder["priority"] = "action", kind = key.split(":").slice(0, 2).join(":")): Reminder => ({ key, kind, priority, text: `Text ${key}`, short: `Short ${key}`, href: "/approval", linkLabel: "Open Review inbox" });
const T1 = "2026-11-05T08:00:00.000Z", T2 = "2026-11-05T08:05:00.000Z", T3 = "2026-11-05T08:10:00.000Z";

test("new action reminders arrive unread; information never reaches the inbox", () => {
  const inbox = mergeInbox([], [reminder("approval:submitted:a"), reminder("approval:approved:c", "info")], T1);
  assert.deepEqual(inbox.map(e => [e.key, e.read, e.popped, e.active, e.at]), [["approval:submitted:a", false, false, true, T1]]);
  assert.equal(unreadCount(inbox), 1);
});

test("read state is honest: only showing the entry in the open Inbox marks it read", () => {
  let inbox = mergeInbox([], [reminder("approval:submitted:a"), reminder("approval:review:b")], T1);
  inbox = markPopped(inbox, ["approval:submitted:a"]);
  assert.equal(unreadCount(inbox), 2, "a popup that was closed does not make anything read");
  inbox = markRead(inbox, T2, ["approval:review:b"]);
  assert.equal(unreadCount(inbox), 1);
  assert.equal(inbox.find(e => e.key === "approval:review:b")!.readAt, T2);
  inbox = markRead(inbox, T3);
  assert.equal(unreadCount(inbox), 0);
  assert.equal(inbox.find(e => e.key === "approval:review:b")!.readAt, T2, "an earlier read time is kept");
  assert.ok(isNewSince(inbox.find(e => e.key === "approval:submitted:a")!, T3), "labelled New during the visit that showed it");
  assert.ok(!isNewSince(inbox.find(e => e.key === "approval:review:b")!, T3), "not New on a later visit");
  assert.ok(!isNewSince(inbox[0], null), "nothing is New while the Inbox is closed");
});

test("dedupe: same key is one entry, refreshed wording keeps read state; superseded unread entries are replaced", () => {
  let inbox = mergeInbox([], [reminder("approval:submitted:a")], T1);
  inbox = mergeInbox(inbox, [reminder("approval:submitted:a"), reminder("approval:submitted:a")], T2);
  assert.equal(inbox.length, 1, "duplicates collapse");
  assert.equal(inbox[0].at, T1, "first raised time is kept");
  // A new submission arrives before the first notice was read: the newer summary replaces it.
  inbox = mergeInbox(inbox, [reminder("approval:submitted:a,b")], T2);
  assert.deepEqual(inbox.map(e => e.key), ["approval:submitted:a,b"]);
  // Once read, an older entry stays as history when superseded.
  inbox = markRead(inbox, T2);
  inbox = mergeInbox(inbox, [reminder("approval:submitted:a,b,c")], T3);
  assert.deepEqual(inbox.map(e => [e.key, e.active, e.read]), [["approval:submitted:a,b,c", true, false], ["approval:submitted:a,b", false, true]]);
});

test("a situation that passes stays listed; if it returns it is a new, unread occurrence", () => {
  let inbox = markRead(mergeInbox([], [reminder("sync:error", "urgent", "sync:error")], T1), T1);
  inbox = mergeInbox(inbox, [], T2);
  assert.deepEqual(inbox.map(e => [e.active, e.read]), [[false, true]]);
  inbox = mergeInbox(inbox, [reminder("sync:error", "urgent", "sync:error")], T3);
  assert.deepEqual(inbox.map(e => [e.active, e.read, e.popped, e.at, e.readAt]), [[true, false, false, T3, undefined]]);
  // Old inactive entries are capped.
  let many: InboxEntry[] = [];
  for (let i = 0; i < MAX_INACTIVE + 10; i++) many = markRead(mergeInbox(many, [reminder(`chair:k${i}:x`, "action", `chair:k${i}`)], `2026-11-05T09:${String(i).padStart(2, "0")}:00.000Z`), T1);
  many = mergeInbox(many, [], T3);
  assert.equal(many.length, MAX_INACTIVE);
  assert.equal(many[0].key, `chair:k${MAX_INACTIVE + 9}:x`, "newest kept first");
});

test("popups: most pressing unread first, shown once, and still in the inbox afterwards", () => {
  let inbox = mergeInbox([], [reminder("approval:review:b"), reminder("sync:conflict:1", "urgent", "sync:conflict")], T1);
  const popup = nextPopup(inbox)!;
  assert.equal(popup.entry.key, "sync:conflict:1");
  assert.equal(popup.more, 1);
  inbox = markPopped(inbox, popup.keys);
  assert.equal(nextPopup(inbox), null, "a dismissed popup never repeats");
  assert.equal(inbox.length, 2, "both remain discoverable in the inbox");
  assert.equal(unreadCount(inbox), 2);
  inbox = mergeInbox(inbox, [reminder("approval:review:b"), reminder("sync:conflict:1", "urgent", "sync:conflict"), reminder("approval:submitted:z")], T2);
  assert.equal(nextPopup(inbox)!.entry.key, "approval:submitted:z", "a later arrival gets its own popup");
  assert.equal(nextPopup(markRead(inbox, T2)), null, "read entries never pop up");
});

test("storage parsing tolerates corrupt or hostile values", () => {
  for (const bad of [null, "", "not json", "{", "42", '"text"', "{}", "null", '[1,"x",null,{}]']) {
    assert.deepEqual(parseInbox(bad, "approval"), [], String(bad));
    assert.deepEqual(parseStoredChat(bad, "approval"), [], String(bad));
  }
  const entry = { key: "k", kind: "k", priority: "action", text: "t", short: "s", at: T1, read: false, popped: false, active: true };
  const saved = JSON.stringify([entry, { ...entry }, { ...entry, key: "evil", href: "https://evil.example" }, { ...entry, key: "other-role", href: "/admin/access-codes" }, { ...entry, key: "ok", href: "/approval/history", linkLabel: "Open History" }, { ...entry, key: "bad-priority", priority: "info" }]);
  const parsed = parseInbox(saved, "approval");
  assert.deepEqual(parsed.map(e => e.key), ["k", "evil", "other-role", "ok"], "duplicates and invalid shapes dropped");
  assert.equal(parsed.find(e => e.key === "evil")!.href, undefined);
  assert.equal(parsed.find(e => e.key === "other-role")!.href, undefined, "links outside the role are dropped");
  assert.equal(parsed.find(e => e.key === "ok")!.href, "/approval/history");

  const chat = JSON.stringify([...Array.from({ length: 70 }, (_, i) => ({ id: i, from: i % 2 ? "felix" : "you", text: `m${i}` })), { id: 99, from: "felix", text: "bad link", href: "https://evil.example" }, { id: 100, from: "felix", text: "ok", href: "/approval/history", linkLabel: "Open History" }, { id: "x", from: "felix", text: "bad id" }, { nope: 1 }]);
  const restored = parseStoredChat(chat, "approval");
  assert.equal(restored.length, MAX_MESSAGES);
  assert.equal(restored.find(m => m.id === 99)?.href, undefined);
  assert.equal(restored.find(m => m.id === 100)?.href, "/approval/history");
  assert.equal(parseStoredChat(JSON.stringify([{ id: 1, from: "felix", text: "x", href: "/approval/history" }]), "logistics")[0].href, undefined, "another role's route is dropped");

  assert.equal(parseMotionPreference(null), true);
  assert.equal(parseMotionPreference("garbage"), true);
  assert.equal(parseMotionPreference("off"), false);
});

test("storage keys are scoped by role and committee", () => {
  assert.deepEqual(felixStorageKeys("chair", "ga1"), { chat: "felix-chat-v1:chair:ga1", inbox: "felix-inbox-v1:chair:ga1" });
  assert.deepEqual(felixStorageKeys("chair"), { chat: "felix-chat-v1:chair:unassigned", inbox: "felix-inbox-v1:chair:unassigned" });
  assert.equal(felixStorageKeys("admin", "ignored").inbox, "felix-inbox-v1:admin");
  assert.equal(MOTION_KEY, "felix-motion-v1");
});

test("the inbox store persists changes, notifies once per change and survives broken storage", () => {
  const memory = new Map<string, string>();
  const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v) };
  const store = new InboxStore("felix-inbox-v1:approval", "approval", storage);
  let calls = 0;
  const off = store.subscribe(() => calls++);
  store.update(e => mergeInbox(e, [reminder("approval:submitted:a")], T1));
  store.update(e => mergeInbox(e, [reminder("approval:submitted:a")], T2));
  assert.equal(calls, 1, "an update that changes nothing does not notify");
  assert.equal(parseInbox(memory.get("felix-inbox-v1:approval")!, "approval").length, 1);
  assert.equal(new InboxStore("felix-inbox-v1:approval", "approval", storage).getSnapshot()[0].key, "approval:submitted:a", "restored from storage");
  off();
  const broken = new InboxStore("k", "approval", { getItem: () => { throw Error("blocked"); }, setItem: () => { throw Error("full"); } });
  broken.update(e => mergeInbox(e, [reminder("approval:submitted:a")], T1));
  assert.equal(broken.getSnapshot().length, 1, "still works for this page");
  assert.equal(new InboxStore("k", "approval", null).getSnapshot().length, 0);
});
