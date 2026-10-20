import type { Role } from "./domain";

/** Stable workspace names shared by the chooser and the operational masthead. */
export const workspaces: { id: Role; name: string; description: string; icon: string }[] = [
  { id: "chair", name: "Chair Console", description: "Run debate, roll call and participation.", icon: "debate" },
  { id: "approval", name: "Approval Panel", description: "Review resolutions and give feedback.", icon: "review" },
  { id: "logistics", name: "Admins", description: "Manage the print queue and copies.", icon: "print" },
  { id: "admin", name: "Executive", description: "Coordinate the programme, people and scoring.", icon: "settings" },
];
