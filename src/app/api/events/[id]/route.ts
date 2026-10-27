import { getEvent } from "@/server/lifecycle/service";
import { respond } from "../../_lib/http";

export async function GET(_request: Request, ctx: RouteContext<"/api/events/[id]">) {
  const { id } = await ctx.params;
  return respond(() => getEvent(id));
}
