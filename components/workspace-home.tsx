import Link from "next/link";
import type { Conference, Role } from "@/lib/domain";
import { workspaces } from "@/lib/workspaces";
import { Brand } from "./brand";
import { Icon } from "./ui";
import styles from "./workspace-home.module.css";

/** An entry screen, not another dashboard: choose a role without fetching or implying live status. */
export function WorkspaceHome({ conference, availableRoles, demo }: {
  conference: Pick<Conference, "name" | "venue">;
  availableRoles: Role[];
  demo: boolean;
}) {
  const choices = workspaces.filter(workspace => availableRoles.includes(workspace.id));
  return <div className={styles.home}>
    <a className={styles.skip} href="#choose-workspace">Skip to workspaces</a>
    <header className={styles.header}>
      <div className={styles.frame}>
        <Brand size={40} />
        <span className={styles.access}>{demo ? "Interactive demo" : "Staff workspace"}</span>
      </div>
    </header>
    <div className={styles.context}>
      <div className={styles.frame}>
        <strong>{conference.name}</strong>
        {conference.venue && <span>{conference.venue}</span>}
      </div>
    </div>
    <main className={styles.main} id="choose-workspace" tabIndex={-1}>
      <div className={styles.intro}>
        <p className={styles.eyebrow}>CONFERENCE OPERATIONS</p>
        <h1>Choose your workspace.</h1>
        <p>{demo ? "Explore the tools for each team using illustrative conference data." : "Open the tools for your role. Only your assigned workspaces are shown."}</p>
      </div>
      <nav aria-label="Choose a workspace" className={styles.choices}>
        {choices.map(workspace => <Link className={styles.card} key={workspace.id} href={`/${workspace.id}`}>
          <span className={styles.icon} aria-hidden="true"><Icon name={workspace.icon} /></span>
          <div className={styles.copy}><h2>{workspace.name}</h2><span>{workspace.description}</span></div>
          <span className={styles.arrow} aria-hidden="true"><Icon name="arrow" /></span>
          <span className={styles.enter} aria-hidden="true">Open workspace</span>
        </Link>)}
      </nav>
      <footer className={styles.footer}>
        <span>One conference. Every team connected.</span>
        <span>{demo ? "Demo data · not official records" : "Need another role? Ask the Executive team."}</span>
      </footer>
    </main>
  </div>;
}
