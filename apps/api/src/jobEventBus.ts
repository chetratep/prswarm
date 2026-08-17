// Tiny in-process pub-sub for job progress, keyed by job id. Backed by one
// EventEmitter per job (created lazily, torn down once its last SSE listener
// unsubscribes) rather than a single shared emitter, so listeners for one
// job can never receive another job's events and nothing lingers in memory
// after a job's SSE clients disconnect.
import { EventEmitter } from "node:events";
import type { JobEvent } from "@bulk-github-update-tool/shared-types";

const emitters = new Map<string, EventEmitter>();

const EVENT_NAME = "event";

function getOrCreateEmitter(jobId: string): EventEmitter {
  let emitter = emitters.get(jobId);
  if (!emitter) {
    emitter = new EventEmitter();
    // A single job's progress can legitimately be watched by more than one
    // SSE client (e.g. two browser tabs) — don't let Node warn about a
    // "possible EventEmitter memory leak" for a handful of listeners.
    emitter.setMaxListeners(0);
    emitters.set(jobId, emitter);
  }
  return emitter;
}

/** Subscribe to every JobEvent published for `jobId`. Returns an unsubscribe
 * function — always call it when the consumer (e.g. an SSE connection) goes
 * away, so the underlying emitter can be garbage collected once nobody is
 * listening to this job anymore. */
export function subscribeToJob(jobId: string, listener: (event: JobEvent) => void): () => void {
  const emitter = getOrCreateEmitter(jobId);
  emitter.on(EVENT_NAME, listener);

  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    emitter.off(EVENT_NAME, listener);
    if (emitter.listenerCount(EVENT_NAME) === 0) {
      emitters.delete(jobId);
    }
  };
}

/** Publish a JobEvent for `jobId` to every currently-subscribed listener. If
 * nobody is subscribed (e.g. no SSE client has connected yet), the event is
 * simply dropped — a client connecting later gets caught up via the
 * `snapshot` event the SSE route sends on connect, not via a backlog here. */
export function publishJobEvent(jobId: string, event: JobEvent): void {
  const emitter = emitters.get(jobId);
  if (!emitter) return;
  emitter.emit(EVENT_NAME, event);
}
