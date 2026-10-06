import { probe, type HealthReport } from "@/lib/platform/health-probe";
// Public, cache-friendly health endpoint for uptime monitors and the System
// health screen. It reveals build identity and reachability only.
export const dynamic = "force-dynamic";
let cached: { at: number; report: HealthReport } | undefined;
const TTL = 15_000;
let pending: Promise<HealthReport> | undefined;
export async function GET() {
  // Many devices and monitors may ask at once; one probe per instance per TTL.
  if (!cached || Date.now() - cached.at > TTL) {
    pending ??= probe().finally(()=>{pending=undefined;});
    cached = {at:Date.now(),report:await pending};
  }
  const { report } = cached;
  return Response.json(report, {
    status: report.status === "down" ? 503 : 200,
    headers: { "Cache-Control": "public, max-age=0, s-maxage=15, stale-while-revalidate=30" },
  });
}
