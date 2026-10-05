"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { DurableStore } from "./sync/store";
const preferences = new DurableStore();
import { ConferenceData, Role } from "./domain";
import { Command, repository } from "./repository";
const Context = createContext<{
  data: ConferenceData;
  act: (c: Command, role: Role) => Promise<boolean>;
  notice: string;
  committeeId: string;
  setCommitteeId: (id: string) => void;
  selectedSessionId: string;
  setSelectedSessionId: (id: string) => void;
} | null>(null);
export function ConferenceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const data = useSyncExternalStore(
    repository.subscribe,
    repository.getSnapshot,
    () => null,
  );
  const health = useSyncExternalStore(repository.subscribe, repository.getHealth, repository.getHealth);
  const [notice, setNotice] = useState("");
  const [committeeId, setCommitteeId] = useState("ga1");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  useEffect(() => repository.initialize(), []);
  const contextConferenceId = data?.conference.id;
  useEffect(()=>{
    if(!contextConferenceId)return;
    void preferences.readPreferences(`context:${contextConferenceId}`).then(saved=>{
      if(saved?.committeeId)setCommitteeId(saved.committeeId);
      if(saved?.sessionId)setSelectedSessionId(saved.sessionId);
    });
  },[contextConferenceId]);
  async function act(c: Command, role: Role) {
    try {
      await repository.execute(c, role);
      setNotice(
        c.type === "timer"
          ? ""
          : c.type === "event"
            ? "Participation event updated"
            : c.type === "participation"
              ? "Participation recorded"
              : c.type === "document"
                ? `Resolution moved to ${c.status}`
                : repository.getHealth().message,
      );
      return true;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Unable to save");
      return false;
    }
  }
  if (!data)
    return <div className="loading">{health.message}</div>;
  return (
    <Context.Provider
      value={{
        data,
        act,
        notice,
        committeeId,
        setCommitteeId: id=>{setCommitteeId(id);setSelectedSessionId("");void preferences.savePreferences(`context:${data.conference.id}`,{committeeId:id,sessionId:""});},
        selectedSessionId,
        setSelectedSessionId: id=>{setSelectedSessionId(id);void preferences.savePreferences(`context:${data.conference.id}`,{sessionId:id});},
      }}
    >
      {children}
      <div className="toast" role="status" key={notice}>
        {notice}
      </div>
    </Context.Provider>
  );
}
export function useConference() {
  const context = useContext(Context);
  if (!context) throw Error("Conference provider missing");
  return context;
}
