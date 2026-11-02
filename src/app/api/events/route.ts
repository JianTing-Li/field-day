import { Api } from "@/contracts";
import { checkNewBrief, createEvent, listEvents } from "@/server/lifecycle/service";
import { parseBody, respond } from "../_lib/http";
import { limitEventCreation } from "../_lib/rate-limit";

/** Agent runs and first-request seeding can take minutes; the run budget stops at 240 s (D-JT19-3). */
export const maxDuration = 300;

export async function GET() {
  return respond(listEvents);
}

/** Checked first, then counted: only a valid brief uses one of the visitor's new-event slots. */
export async function POST(request: Request) {
  const body = await parseBody(request, Api.createEvent.request);
  if (!body.ok) return body.response;
  try {
    checkNewBrief(body.data.brief);
  } catch (e) {
    return respond(() => Promise.reject(e));
  }
  return limitEventCreation(request, () => respond(() => createEvent(body.data)));
}
