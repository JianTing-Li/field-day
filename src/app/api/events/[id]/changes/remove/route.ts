import { Api } from "@/contracts";
import { removeReport } from "@/server/lifecycle/service";
import { handle } from "../../../../_lib/http";

export async function POST(request: Request, ctx: RouteContext<"/api/events/[id]/changes/remove">) {
  const { id } = await ctx.params;
  return handle(request, Api.removeReport.request, (body) => removeReport(id, body));
}
