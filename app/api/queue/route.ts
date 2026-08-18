import { withQueueMutation } from "../../../lib/queue/store";
import type { QueueState } from "../../../lib/queue/types";
import { buildView } from "../../../lib/queue/view";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  const mutationResult: { state: QueueState; now: number } = await withQueueMutation(
    (state, now) => ({
      next: state,
      result: { state, now },
    }),
  );

  const view = buildView(mutationResult.state, id, mutationResult.now);
  return Response.json(view, { status: 200 });
}
