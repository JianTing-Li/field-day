import { Api } from "@/contracts";
import { createEvent, listEvents } from "@/server/lifecycle/service";
import { handle, respond } from "../_lib/http";

/** Agent runs and first-request seeding can take minutes; the run budget stops at 240 s (D-JT19-3). */
export const maxDuration = 300;

export async function GET() {
  return respond(listEvents);
}

export async function POST(request: Request) {
  return handle(request, Api.createEvent.request, createEvent);
}
