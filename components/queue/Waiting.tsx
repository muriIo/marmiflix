"use client";

import { formatDuration } from "../../lib/format";
import type { UseQueueResult } from "../../hooks/useQueue";

export function Waiting({ queue }: { queue: UseQueueResult }) {
  const view = queue.view;
  const self = view?.self;

  async function handleLeave() {
    await queue.actions.leave();
  }

  return (
    <div className="rounded-3xl bg-char-800 border border-char-700 p-8 shadow-glow">
      <p className="text-sm uppercase tracking-[0.2em] text-ember-500 font-semibold mb-2">
        Você está na fila
      </p>
      <h1 className="text-3xl font-bold text-cream-100 mb-6 leading-tight">
        Aguarde sua vez
      </h1>

      <div className="flex items-baseline gap-3 mb-2">
        <span className="font-mono text-5xl font-bold text-amber-400">
          {self?.position ?? "-"}º
        </span>
        <span className="text-cream-500">na fila</span>
      </div>

      <p className="text-cream-300 mb-6">
        Espera estimada de{" "}
        <span className="font-mono text-amber-400 font-semibold">
          {formatDuration(self?.estimatedWaitMs ?? 0)}
        </span>
        .
      </p>

      {view && view.namesAhead.length > 0 && (
        <div className="mb-8">
          <p className="text-sm uppercase tracking-[0.15em] text-cream-500 mb-2">
            Na sua frente
          </p>
          <ol className="space-y-1 text-cream-300">
            {view.namesAhead.map((name, index) => (
              <li key={`${index}-${name}`} className="flex items-center gap-2">
                <span className="font-mono text-cream-500">{index + 1}.</span>
                {name}
              </li>
            ))}
          </ol>
        </div>
      )}
      {(!view || view.namesAhead.length === 0) && <div className="mb-8" />}

      <button
        type="button"
        onClick={handleLeave}
        className="w-full rounded-xl border border-char-600 px-4 py-3 font-semibold text-cream-300 transition-colors hover:border-alarm-500 hover:text-alarm-500"
      >
        Sair da fila
      </button>
    </div>
  );
}
