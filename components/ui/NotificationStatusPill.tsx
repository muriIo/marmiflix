"use client";

import { useState } from "react";
import { useNotificationPermission } from "../../hooks/useNotificationPermission";
import { requestPushSubscription } from "../../lib/notifications/client";

const LABEL: Record<string, string> = {
  granted: "Notificações ativadas",
  denied: "Notificações bloqueadas",
  default: "Notificações desativadas",
};

const DOT_CLASS: Record<string, string> = {
  granted: "bg-ember-500",
  denied: "bg-alarm-500",
  default: "bg-char-600",
};

export function NotificationStatusPill() {
  const permission = useNotificationPermission();
  const [requesting, setRequesting] = useState(false);
  const [showHint, setShowHint] = useState(false);

  if (permission === "unsupported") {
    return null;
  }

  // A denied permission can't be re-prompted from JS (the browser silently
  // ignores requestPermission() once blocked) - the only honest "change this
  // setting" action here is pointing the visitor at their browser's own UI.
  async function handleClick() {
    if (permission === "denied") {
      setShowHint((value) => !value);
      return;
    }
    if (requesting) {
      return;
    }
    setRequesting(true);
    try {
      await requestPushSubscription();
    } finally {
      setRequesting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-char-600 bg-char-900 px-3 py-2 text-sm">
        <span className="flex items-center gap-2 text-cream-300">
          <span className={`h-2 w-2 rounded-full ${DOT_CLASS[permission]}`} />
          {LABEL[permission]}
        </span>
        {permission !== "granted" && (
          <button
            type="button"
            onClick={handleClick}
            disabled={requesting}
            className="shrink-0 text-xs font-semibold text-ember-500 underline decoration-dotted underline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {permission === "denied" ? "Como ativar" : requesting ? "Ativando..." : "Ativar"}
          </button>
        )}
      </div>
      {showHint && permission === "denied" && (
        <p className="mt-2 text-xs text-cream-500">
          Seu navegador bloqueou as notificações deste site. Habilite em Configurações do
          navegador → Notificações para ser avisado quando chegar sua vez.
        </p>
      )}
    </div>
  );
}
