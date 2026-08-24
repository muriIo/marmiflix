import { checkRateLimit } from "../../../../../lib/queue/rate-limit";
import { QueueBusyError, queueBusyResponse } from "../../../../../lib/queue/route-helpers";
import { verifyToken } from "../../../../../lib/queue/session";
import { getState, withQueueMutation } from "../../../../../lib/queue/store";

export async function POST(request: Request): Promise<Response> {
  let body: { id?: unknown; token?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const id = typeof body.id === "string" ? body.id : "";
  const token = typeof body.token === "string" ? body.token : "";

  const allowed = await checkRateLimit(`waitlist-leave:${id || "unknown"}`);
  if (!allowed) {
    return Response.json(
      { error: "Muitas tentativas. Tente novamente em instantes." },
      { status: 429 },
    );
  }

  const state = await getState();
  const entry = state.seatWaitlist.find((waitlistEntry) => waitlistEntry.id === id);

  if (!entry) {
    return Response.json({ error: "Registro de fila de espera não encontrado" }, { status: 404 });
  }

  if (!verifyToken(token, entry.tokenHash)) {
    return Response.json({ error: "Token inválido" }, { status: 403 });
  }

  try {
    await withQueueMutation((currentState) => {
      const next = {
        ...currentState,
        seatWaitlist: currentState.seatWaitlist.filter(
          (waitlistEntry) => waitlistEntry.id !== id,
        ),
      };
      return { next, result: next };
    });
  } catch (error) {
    if (error instanceof QueueBusyError) {
      return queueBusyResponse();
    }
    throw error;
  }

  return Response.json({ ok: true }, { status: 200 });
}
