"use client";

import { useEffect, useState } from "react";
import { requestPushSubscription } from "../../lib/notifications/client";
import { playTurnChime } from "../../lib/sound";
import {
  clearWaitlistIdentity,
  getWaitlistIdentity,
  setWaitlistIdentity,
} from "../../lib/waitlist-identity";

async function postJson(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export function QueueFull({ onLeaveWaitlist }: { onLeaveWaitlist: () => void }) {
  const [registered, setRegistered] = useState(() => getWaitlistIdentity() !== null);
  const [submitting, setSubmitting] = useState(false);

  // A visitor on this screen has no queue entry to poll for - the SW's
  // `push` handler relays the seat-opened payload via postMessage when this
  // tab is focused (see public/sw.js's design-correction note), and this is
  // the one place that listens for it directly instead of relying on the
  // existing poll-driven detection the other three scenarios use.
  useEffect(() => {
    if (!registered || typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    function handleMessage(event: MessageEvent) {
      const data = event.data as { scenario?: string } | undefined;
      if (data?.scenario === "seat-opened") {
        playTurnChime();
        if (typeof navigator.vibrate === "function") {
          navigator.vibrate(200);
        }
      }
    }
    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, [registered]);

  async function handleOptIn() {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    try {
      const subscription = await requestPushSubscription();
      if (!subscription) {
        // No push permission grantable - registering without a channel is a
        // no-op (no sound/vibration channel possible on a screen the visitor
        // isn't watching), per spec.md's waitlist registration requirement.
        return;
      }
      const data = await postJson("/api/queue/waitlist/join", { subscription });
      if (typeof data.id === "string" && typeof data.token === "string") {
        setWaitlistIdentity({ id: data.id, token: data.token });
        setRegistered(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    const identity = getWaitlistIdentity();
    if (!identity || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await postJson("/api/queue/waitlist/leave", { id: identity.id, token: identity.token });
      clearWaitlistIdentity();
      setRegistered(false);
      onLeaveWaitlist();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-3xl bg-char-800 border border-char-700 p-8 shadow-glow text-center">
      <p className="text-sm uppercase tracking-[0.2em] text-ember-500 font-semibold mb-2">
        Fila cheia
      </p>
      <h1 className="text-3xl font-bold text-cream-100 mb-6 leading-tight">
        A fila está cheia no momento
      </h1>
      <p className="text-cream-300 mb-8">
        Já são 100 pessoas na fila. Avise-me quando uma vaga abrir e eu te chamo de volta.
      </p>

      {registered ? (
        <>
          <p className="text-cream-300 mb-6">Você será avisado quando uma vaga abrir.</p>
          <button
            type="button"
            onClick={handleCancel}
            disabled={submitting}
            className="w-full rounded-xl bg-char-700 border border-char-600 px-4 py-3 font-semibold text-cream-100 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Cancelando..." : "Cancelar aviso"}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={handleOptIn}
          disabled={submitting}
          className="w-full rounded-xl bg-gradient-to-r from-ember-500 to-amber-500 px-4 py-3 font-semibold text-char-950 transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Registrando..." : "Avisar quando abrir uma vaga"}
        </button>
      )}
    </div>
  );
}
