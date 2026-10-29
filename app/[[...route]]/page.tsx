import { Workspace } from "@/components/workspace";
import { notFound } from "next/navigation";
const paths = [
  "",
  "chair",
  "chair/roll-call",
  "chair/participation",
  "chair/documents",
  "chair/amendments",
  "chair/voting",
  "chair/photos",
  "chair/health",
  "approval",
  "approval/history",
  "approval/health",
  "logistics",
  "logistics/completed",
  "logistics/health",
  "admin",
  "admin/resolution-status",
  "admin/held",
  "admin/conference",
  "admin/committees",
  "admin/sessions",
  "admin/schedule",
  "admin/delegates",
  "admin/schools",
  "admin/photos",
  "admin/staff",
  "admin/access-codes",
  "admin/scoring",
  "admin/workflow",
  "admin/submissions",
  "admin/amendment-links",
  "admin/audit",
  "admin/health",
];
export function generateStaticParams() {
  return paths.map((p) => ({ route: p ? p.split("/") : [] }));
}
export default async function Page({
  params,
}: {
  params: Promise<{ route?: string[] }>;
}) {
  const { route = [] } = await params;
  const path = route.join("/");
  if (!paths.includes(path)) notFound();
  return <Workspace path={path} />;
}
