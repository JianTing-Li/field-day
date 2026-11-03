import { Api } from "@/contracts";
import { readChangeText } from "@/server/lifecycle/service";
import { parseBody, respond } from "../../../../_lib/http";
import { limitChangeReads } from "../../../../_lib/rate-limit";

/** Reads "Something changed?" text into a list of changes; changes nothing (JT-28). */
export async function POST(request: Request, ctx: RouteContext<"/api/events/[id]/changes/read">) {
  const { id } = await ctx.params;
  const body = await parseBody(request, Api.readChanges.request);
  if (!body.ok) return body.response;
  return limitChangeReads(request, () => respond(() => readChangeText(id, body.data)));
}
