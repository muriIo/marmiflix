"use client";

import { useEffect, useState } from "react";
import confetti from "canvas-confetti";
import { motion } from "framer-motion";
import type { UseQueueResult } from "../../hooks/useQueue";

export function ConfirmTurn({ queue }: { queue: UseQueueResult }) {
  const [submitting, setSubmitting] = useState(false);
  const deadline = queue.view?.self?.deadline ?? null;
  const [remainingMs, setRemainingMs] = useState(() =>
    deadline !== null ? Math.max(0, deadline - queue.now()) : 0,
  );

  useEffect(() => {
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(200);
    }
    confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
  }, []);

  useEffect(() => {
    if (deadline === null) {
      return;
    }
    const tick = () => setRemainingMs(Math.max(0, deadline - queue.now()));
    tick();
    const interval = setInterval(tick, 200);
    return () => clearInterval(interval);
  }, [deadline, queue]);

  async function handleConfirm() {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await queue.actions.confirmTurn();
    } finally {
      setSubmitting(false);
    }
  }

  const secondsLeft = Math.ceil(remainingMs / 1000);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 20 }}
      className="rounded-3xl bg-char-800 border border-ember-500 p-8 shadow-glow text-center"
    >
      <p className="text-sm uppercase tracking-[0.2em] text-ember-500 font-semibold mb-2">
        Chegou a sua vez
      </p>
      <h1 className="text-3xl font-bold text-cream-100 mb-6 leading-tight">
        É a sua vez!
      </h1>

      <div className="font-mono text-6xl font-bold text-amber-400 mb-6">
        {secondsLeft}s
      </div>

      <button
        type="button"
        onClick={handleConfirm}
        disabled={submitting}
        className="w-full rounded-xl bg-gradient-to-r from-ember-500 to-amber-500 px-4 py-3 font-semibold text-char-950 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? "Confirmando..." : "É a minha vez!"}
      </button>
    </motion.div>
  );
}
