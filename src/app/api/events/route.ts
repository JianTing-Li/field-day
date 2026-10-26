import { Api } from "@/contracts";
import { createEvent, listEvents } from "@/server/lifecycle/service";
import { handle, respond } from "../_lib/http";

export async function GET() {
  return respond(listEvents);
}

export async function POST(request: Request) {
  return handle(request, Api.createEvent.request, createEvent);
}
