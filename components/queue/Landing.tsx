"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { formatDuration } from "../../lib/format";
import { QueueActionError, type UseQueueResult } from "../../hooks/useQueue";
import { requestPushSubscription } from "../../lib/notifications/client";
import { clearWaitlistIdentity, getWaitlistIdentity } from "../../lib/waitlist-identity";
import { NotificationStatusPill } from "../ui/NotificationStatusPill";
import { QueueFull } from "./QueueFull";

export function Landing({ queue }: { queue: UseQueueResult }) {
  const [name, setName] = useState("");
  const [notifyOptIn, setNotifyOptIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [queueFull, setQueueFull] = useState(false);

  const view = queue.view;
  const isEmpty = (view?.queueCount ?? 0) === 0;
  const trimmedName = name.trim();

  if (queueFull) {
    return <QueueFull onLeaveWaitlist={() => setQueueFull(false)} />;
  }

  async function handleJoin(event: FormEvent) {
    event.preventDefault();
    if (!trimmedName || submitting) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const subscription = notifyOptIn ? await requestPushSubscription() : null;
      const waitlistIdentity = getWaitlistIdentity();
      await queue.actions.join(
        trimmedName,
        subscription ?? undefined,
        waitlistIdentity ?? undefined,
      );
      if (waitlistIdentity) {
        clearWaitlistIdentity();
      }
    } catch (err) {
      if (err instanceof QueueActionError && err.code === "QUEUE_FULL") {
        setQueueFull(true);
        return;
      }
      setError(
        err instanceof QueueActionError
          ? err.message
          : "Não foi possível entrar na fila. Tente novamente.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-3xl bg-char-800 border border-char-700 p-8 shadow-glow">
      <p className="text-sm uppercase tracking-[0.2em] text-ember-500 font-semibold mb-2">
        Fila da Marmita
      </p>
      <h1 className="text-3xl font-bold text-cream-100 mb-6 leading-tight">
        {isEmpty ? "Sem espera - entre agora" : "Organize sua vez no micro-ondas"}
      </h1>

      <div className="flex items-baseline gap-3 mb-6">
        <span className="font-mono text-5xl font-bold text-amber-400">
          {view?.queueCount ?? 0}
        </span>
        <span className="text-cream-500">
          {view?.queueCount === 1 ? "pessoa na fila" : "pessoas na fila"}
        </span>
      </div>

      {!isEmpty && (
        <p className="text-cream-300 mb-8">
          Se você entrar agora, sua espera estimada é de{" "}
          <span className="font-mono text-amber-400 font-semibold">
            {formatDuration(view?.estimatedWaitMs ?? 0)}
          </span>
          .
        </p>
      )}
      {isEmpty && <div className="mb-8" />}

      <form onSubmit={handleJoin} className="space-y-4">
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Seu nome"
          maxLength={40}
          aria-label="Seu nome"
          className="w-full rounded-xl bg-char-900 border border-char-600 px-4 py-3 text-cream-100 placeholder:text-cream-500 focus:outline-none focus:ring-2 focus:ring-ember-500"
        />
        <label className="flex items-center gap-2 text-sm text-cream-300">
          <input
            type="checkbox"
            checked={notifyOptIn}
            onChange={(event) => setNotifyOptIn(event.target.checked)}
            className="h-4 w-4 rounded border-char-600 bg-char-900 accent-ember-500"
          />
          Avisar mesmo se eu fechar a aba
        </label>
        <NotificationStatusPill />
        {error && (
          <p role="alert" className="text-alarm-500 text-sm">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={!trimmedName || submitting}
          className="w-full rounded-xl bg-gradient-to-r from-ember-500 to-amber-500 px-4 py-3 font-semibold text-char-950 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Entrando..." : "Entrar na fila"}
        </button>
      </form>

      <p className="text-xs text-cream-500 mt-6 text-center">
        Ao entrar na fila, você concorda com os{" "}
        <Link href="/termos" className="text-ember-500 underline">
          Termos de Uso
        </Link>{" "}
        e a{" "}
        <Link href="/privacidade" className="text-ember-500 underline">
          Política de Privacidade
        </Link>
        .
      </p>
    </div>
  );
}
