"use client";

import { ConfirmTurn } from "../components/queue/ConfirmTurn";
import { ErrorScreen } from "../components/queue/ErrorScreen";
import { Heating } from "../components/queue/Heating";
import { Landing } from "../components/queue/Landing";
import { Loading } from "../components/queue/Loading";
import { Waiting } from "../components/queue/Waiting";
import { useQueue, type UseQueueResult } from "../hooks/useQueue";

function PhaseRouter({ queue }: { queue: UseQueueResult }) {
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
  return <Landing queue={queue} />;
}

export default function Home() {
  const queue = useQueue();

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <PhaseRouter queue={queue} />
      </div>
    </main>
  );
}
