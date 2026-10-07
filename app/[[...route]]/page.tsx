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
  "chair/awards",
  "chair/photos",
  "approval",
  "logistics",
  "admin",
  "admin/conference",
  "admin/committees",
  "admin/sessions",
  "admin/schedule",
  "admin/delegates",
  "admin/schools",
  "admin/photos",
  "admin/staff",
  "admin/scoring",
  "admin/awards",
  "admin/workflow",
  "admin/submissions",
  "admin/amendment-links",
  "admin/resources",
  "admin/audit",
  "admin/health",
  "projector",
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
