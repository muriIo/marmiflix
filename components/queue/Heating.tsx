"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "../../lib/format";
import type { UseQueueResult } from "../../hooks/useQueue";
import { MicrowaveBowl } from "./MicrowaveBowl";

export function Heating({ queue }: { queue: UseQueueResult }) {
  const [submitting, setSubmitting] = useState(false);
  const deadline = queue.view?.self?.deadline ?? null;
  const phaseStartedAt = queue.view?.self?.phaseStartedAt ?? null;
  // Server-configured (env-driven) threshold, not a build-time constant, so
  // ops can retune it without a rebuild.
  const heatingUrgencyMs = queue.view?.heatingUrgencyMs ?? 30_000;

  const [now, setNow] = useState(() => queue.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(queue.now()), 200);
    return () => clearInterval(interval);
  }, [queue]);

  const elapsedMs = phaseStartedAt !== null ? Math.max(0, now - phaseStartedAt) : 0;
  const remainingMs = deadline !== null ? Math.max(0, deadline - now) : 0;
  const isUrgent = deadline !== null && remainingMs <= heatingUrgencyMs;

  async function handleFinish() {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await queue.actions.finish();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className={`rounded-3xl border p-8 shadow-glow text-center transition-colors ${
        isUrgent
          ? "bg-char-800 border-alarm-500 animate-pulse-urgent"
          : "bg-char-800 border-char-700"
      }`}
    >
      <MicrowaveBowl isUrgent={isUrgent} />

      <h1 className="text-3xl font-bold text-cream-100 mb-6 leading-tight">
        Sua marmita está no micro-ondas
      </h1>

      <div
        className={`font-mono text-6xl font-bold mb-6 ${
          isUrgent ? "text-alarm-500" : "text-amber-400"
        }`}
      >
        {formatDuration(elapsedMs)}
      </div>

      {isUrgent && (
        <p className="text-alarm-500 text-sm mb-4">
          Quase lá! Não esqueça de retirar sua marmita.
        </p>
      )}

      <button
        type="button"
        onClick={handleFinish}
        disabled={submitting}
        className="w-full rounded-xl bg-gradient-to-r from-ember-500 to-amber-500 px-4 py-3 font-semibold text-char-950 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? "Finalizando..." : "Terminei"}
      </button>
    </div>
  );
}
