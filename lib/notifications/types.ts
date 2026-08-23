import type { PushSubscriptionRecord } from "../queue/types";

export type NotificationScenario =
  | "turn-ready"
  | "heating-ended"
  | "confirm-finish-ending"
  | "seat-opened";

export interface NotificationJob {
  scenario: NotificationScenario;
  recipients: PushSubscriptionRecord[];
}
