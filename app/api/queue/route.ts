import { after } from "next/server";
import { dispatchAll } from "../../../lib/notifications/dispatcher";
import { withQueueMutation } from "../../../lib/queue/store";
import type { QueueState } from "../../../lib/queue/types";
import { buildView } from "../../../lib/queue/view";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  const { result: mutationResult, notificationJobs } = await withQueueMutation<{
    state: QueueState;
    now: number;
  }>((state, now) => ({
    next: state,
    result: { state, now },
  }));

  if (notificationJobs.length > 0) {
    after(() => dispatchAll(notificationJobs));
  }

  const view = buildView(mutationResult.state, id, mutationResult.now);
  return Response.json(view, { status: 200 });
}
