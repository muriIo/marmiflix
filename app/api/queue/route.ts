import { after } from "next/server";
import { dispatchAll } from "../../../lib/notifications/dispatcher";
import { QueueBusyError, queueBusyResponse } from "../../../lib/queue/route-helpers";
import { withQueueMutation } from "../../../lib/queue/store";
import type { QueueState } from "../../../lib/queue/types";
import { buildView } from "../../../lib/queue/view";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  let mutationResult: { state: QueueState; now: number };
  let notificationJobs;
  try {
    ({ result: mutationResult, notificationJobs } = await withQueueMutation<{
      state: QueueState;
      now: number;
    }>((state, now) => ({
      next: state,
      result: { state, now },
    })));
  } catch (error) {
    if (error instanceof QueueBusyError) {
      return queueBusyResponse();
    }
    throw error;
  }

  if (notificationJobs.length > 0) {
    after(() => dispatchAll(notificationJobs));
  }

  const view = buildView(mutationResult.state, id, mutationResult.now);
  return Response.json(view, { status: 200 });
}
