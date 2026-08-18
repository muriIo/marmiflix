"use client";

import type { UseQueueResult } from "../../hooks/useQueue";

// Placeholder - the real screen (name entry, queue count/ETA, pt-BR copy) is
// built out fully in its own task (T29). This exists only so the T28 app
// shell has something real to route to.
export function Landing({ queue: _queue }: { queue: UseQueueResult }) {
  return <p className="text-cream-300">Carregando...</p>;
}
