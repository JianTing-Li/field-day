import { getEvent } from "@/server/lifecycle/service";
import { respond } from "../../_lib/http";

/** Agent runs and first-request seeding can take minutes; the run budget stops at 240 s (D-JT19-3). */
export const maxDuration = 300;

export async function GET(_request: Request, ctx: RouteContext<"/api/events/[id]">) {
  const { id } = await ctx.params;
  return respond(() => getEvent(id));
}
