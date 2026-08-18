import { applyConfirmTurn } from "../../../../lib/queue/engine";
import { checkRateLimit } from "../../../../lib/queue/rate-limit";
import { authorizeEntry } from "../../../../lib/queue/route-helpers";
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

  const allowed = await checkRateLimit(`confirm-turn:${id || "unknown"}`);
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

  try {
    await withQueueMutation((state, now) => {
      const next = applyConfirmTurn(state, { id, sessionTokenHash: auth.entry.sessionTokenHash }, now);
      return { next, result: next };
    });
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
    throw error;
  }

  return Response.json({ ok: true }, { status: 200 });
}
