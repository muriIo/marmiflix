"use client";

import { useCallback, useState } from "react";
import { ConfirmTurn } from "../components/queue/ConfirmTurn";
import { ErrorScreen } from "../components/queue/ErrorScreen";
import { Heating } from "../components/queue/Heating";
import { Landing } from "../components/queue/Landing";
import { Loading } from "../components/queue/Loading";
import { Standby } from "../components/queue/Standby";
import { Waiting } from "../components/queue/Waiting";
import { useIdleTimer } from "../hooks/useIdleTimer";
import { useQueue, type UseQueueResult } from "../hooks/useQueue";
import { IDLE_TIMEOUT_MS } from "../lib/queue/config";

function PhaseRouter({
  queue,
  idle,
  onReturnFromStandby,
}: {
  queue: UseQueueResult;
  idle: boolean;
  onReturnFromStandby: () => void;
}) {
  if (queue.connection === "down") {
    return <ErrorScreen queue={queue} />;
  }

  if (queue.view === null) {
    return <Loading />;
  }

  const phase = queue.view?.self?.phase;
  if (phase === "waiting") {
    return <Waiting queue={queue} />;
  }
  if (phase === "confirming") {
    return <ConfirmTurn queue={queue} />;
  }
  if (phase === "heating") {
    return <Heating queue={queue} />;
  }
  if (idle) {
    return <Standby onReturn={onReturnFromStandby} />;
  }
  return <Landing queue={queue} />;
}

export default function Home() {
  const [idle, setIdle] = useState(false);
  const queue = useQueue({ enabled: !idle });

  // IDLE-01/05: idle detection only counts down while outside the queue
  // (no phase yet) with a healthy, loaded view - never while waiting,
  // confirming, heating, loading, or when the connection is down.
  const outsideQueue =
    queue.connection === "ok" && queue.view !== null && queue.view.self?.phase === undefined;

  useIdleTimer({
    timeoutMs: IDLE_TIMEOUT_MS,
    enabled: outsideQueue && !idle,
    onIdle: () => setIdle(true),
  });

  const handleReturnFromStandby = useCallback(() => setIdle(false), []);

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <PhaseRouter queue={queue} idle={idle} onReturnFromStandby={handleReturnFromStandby} />
      </div>
    </main>
  );
}
