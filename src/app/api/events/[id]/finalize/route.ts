import { Api } from "@/contracts";
import { finalize } from "@/server/lifecycle/service";
import { handle } from "../../../_lib/http";

/** Agent runs and first-request seeding can take minutes; the run budget stops at 240 s (D-JT19-3). */
export const maxDuration = 300;

export async function POST(request: Request, ctx: RouteContext<"/api/events/[id]/finalize">) {
  const { id } = await ctx.params;
  return handle(request, Api.finalize.request, (body) => finalize(id, body));
}
