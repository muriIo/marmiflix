export type Phase = "waiting" | "confirming" | "heating";

export interface WaitingEntry {
  id: string;
  name: string;
  sessionTokenHash: string;
  joinedAt: number;
}

export interface ActiveEntry {
  id: string;
  name: string;
  sessionTokenHash: string;
  phase: "confirming" | "heating";
  phaseStartedAt: number;
  deadline: number;
}

export interface QueueState {
  version: number;
  active: ActiveEntry | null;
  waiting: WaitingEntry[];
}

export interface SelfView {
  id: string;
  phase: Phase;
  position?: number;
  estimatedWaitMs?: number;
  deadline?: number;
}

export interface QueueView {
  queueCount: number;
  estimatedWaitMs: number;
  namesAhead: string[];
  self: SelfView | null;
  serverTime: number;
}

export class DuplicateNameError extends Error {
  constructor(name: string) {
    super(`Esse nome já está na fila: "${name}"`);
    this.name = "DuplicateNameError";
  }
}

export class NotFoundError extends Error {
  constructor(id: string) {
    super(`No queue entry found for id "${id}"`);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends Error {
  constructor(id: string) {
    super(`Session token does not match queue entry "${id}"`);
    this.name = "ForbiddenError";
  }
}

export class WrongPhaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WrongPhaseError";
  }
}

export class QueueBusyError extends Error {
  constructor(message = "Queue is busy, exhausted retries") {
    super(message);
    this.name = "QueueBusyError";
  }
}

// SPEC_DEVIATION: task T8's "Done when" enumerates 5 error classes, but T10
// requires throwing on an empty/whitespace-only name, which isn't any of the
// other 5 semantically. Adding ValidationError as the minimal necessary
// extension rather than overloading an unrelated error type.
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
