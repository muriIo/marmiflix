import { after } from "next/server";
import { dispatchAll } from "../../../../lib/notifications/dispatcher";
import { applyLeave } from "../../../../lib/queue/engine";
import { checkRateLimit } from "../../../../lib/queue/rate-limit";
import { authorizeEntry, QueueBusyError, queueBusyResponse } from "../../../../lib/queue/route-helpers";
import { withQueueMutation } from "../../../../lib/queue/store";
import { ForbiddenError, NotFoundError, WrongPhaseError } from "../../../../lib/queue/types";

export async function POST(request: Request): Promise<Response> {
  let body: { id?: unknown; sessionToken?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const id = typeof body.id === "string" ? body.id : "";
  const sessionToken = typeof body.sessionToken === "string" ? body.sessionToken : "";

  const allowed = await checkRateLimit(`leave:${id || "unknown"}`);
  if (!allowed) {
    return Response.json(
      { error: "Muitas tentativas. Tente novamente em instantes." },
      { status: 429 },
    );
  }

  const auth = await authorizeEntry(id, sessionToken);
  if (!auth.ok) {
    const error = auth.status === 404 ? "Entrada não encontrada na fila" : "Sessão inválida";
    return Response.json({ error }, { status: auth.status });
  }

  let notificationJobs;
  try {
    ({ notificationJobs } = await withQueueMutation((state) => {
      const next = applyLeave(state, { id, sessionTokenHash: auth.entry.sessionTokenHash });
      return { next, result: next };
    }));
  } catch (error) {
    if (error instanceof NotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ForbiddenError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof WrongPhaseError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof QueueBusyError) {
      return queueBusyResponse();
    }
    throw error;
  }

  if (notificationJobs.length > 0) {
    after(() => dispatchAll(notificationJobs));
  }

  return Response.json({ ok: true }, { status: 200 });
}
