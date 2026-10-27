import { Api } from "@/contracts";
import { generateDraft } from "@/server/lifecycle/service";
import { handle } from "../../../_lib/http";

export async function POST(request: Request, ctx: RouteContext<"/api/events/[id]/generate">) {
  const { id } = await ctx.params;
  return handle(request, Api.generateDraft.request, (body) => generateDraft(id, body));
}
