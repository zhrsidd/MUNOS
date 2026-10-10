"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import {usePathname,useRouter} from "next/navigation";
import {StaffAccessGate,StaffAccessStatus} from "../components/staff-access";
import {staffRoleForPath,staffRolePath,type StaffAccess} from "./access";
import {requestPersistentStorage} from "./platform/persistent-storage";
import { DurableStore } from "./sync/store";
const preferences = new DurableStore();
import { ConferenceData, Role } from "./domain";
import { Command, repository } from "./repository";
const Context = createContext<{
  data: ConferenceData;
  access: StaffAccess;
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
  const access=useSyncExternalStore(repository.subscribe,repository.getAccess,repository.getAccess);
  const pathname=usePathname(),router=useRouter();
  const requestedRole=staffRoleForPath(pathname);
  const wrongRole=access.status==="active"&&requestedRole&&!access.roles.includes(requestedRole);
  useEffect(()=>{if(wrongRole&&access.roles.length)router.replace(staffRolePath(access.roles[0]));},[wrongRole,access.roles,router]);
  const [notice, setNotice] = useState("");
  const [committeeId, setCommitteeId] = useState("ga1");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  useEffect(() => repository.initialize(), []);
  // Public delegate pages never mount this provider, so only active staff devices ask.
  useEffect(()=>{void requestPersistentStorage({status:access.status});},[access.status]);
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
  if(access.status!=="demo"&&access.status!=="active")return <StaffAccessGate access={access}/>;
  if(wrongRole)return <div className="loading">Opening your authorized workspace…</div>;
  if (!data)
    return <div className="loading">{health.message}</div>;
  return (
    <Context.Provider
      value={{
        data,
        access,
        act,
        notice,
        committeeId,
        setCommitteeId: id=>{setCommitteeId(id);setSelectedSessionId("");void preferences.savePreferences(`context:${data.conference.id}`,{committeeId:id,sessionId:""});},
        selectedSessionId,
        setSelectedSessionId: id=>{setSelectedSessionId(id);void preferences.savePreferences(`context:${data.conference.id}`,{sessionId:id});},
      }}
    >
      <StaffAccessStatus access={access}/>
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
