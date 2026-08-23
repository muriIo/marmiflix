import type { NotificationScenario } from "./types";

interface NotificationPayload {
  title: string;
  body: string;
}

const STRATEGIES: Record<NotificationScenario, () => NotificationPayload> = {
  "turn-ready": () => ({
    title: "Chegou a sua vez!",
    body: "Confirme sua presença para começar a aquecer sua marmita.",
  }),
  "heating-ended": () => ({
    title: "Tempo de aquecimento esgotado",
    body: "Seus 5 minutos terminaram. Retire sua marmita quando puder.",
  }),
  "confirm-finish-ending": () => ({
    title: "Últimos segundos!",
    body: "Faltam 10 segundos para o fim automático do seu turno.",
  }),
  "seat-opened": () => ({
    title: "Vaga liberada na fila!",
    body: "Entre agora para garantir seu lugar antes que a vaga feche de novo.",
  }),
};

export function buildNotificationPayload(scenario: NotificationScenario): NotificationPayload {
  return STRATEGIES[scenario]();
}
