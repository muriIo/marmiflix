"use client";

import type { UseQueueResult } from "../../hooks/useQueue";

export function ErrorScreen({ queue }: { queue: UseQueueResult }) {
  return (
    <div className="rounded-3xl bg-char-800 border border-alarm-500 p-8 shadow-glow text-center">
      <p className="text-sm uppercase tracking-[0.2em] text-alarm-500 font-semibold mb-2">
        Problema de conexão
      </p>
      <h1 className="text-3xl font-bold text-cream-100 mb-4 leading-tight">
        Sem conexão com o servidor
      </h1>
      <p className="text-cream-300 mb-8">
        Sua posição na fila está segura. Estamos tentando reconectar
        automaticamente.
      </p>

      <div className="flex items-center justify-center gap-2 text-cream-500 mb-8">
        <span className="h-2 w-2 rounded-full bg-ember-500 animate-pulse-urgent" />
        Tentando reconectar...
      </div>

      <button
        type="button"
        onClick={queue.retryNow}
        className="w-full rounded-xl bg-gradient-to-r from-ember-500 to-amber-500 px-4 py-3 font-semibold text-char-950"
      >
        Tentar agora
      </button>
    </div>
  );
}
