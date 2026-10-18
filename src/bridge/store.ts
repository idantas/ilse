import { randomUUID } from 'node:crypto';
import type { Annotation, AnnotationStatus } from '../types.js';

const annotations = new Map<string, Annotation>();

let changeListeners: Array<() => void> = [];

// ── Session model ─────────────────────────────────────────────────────────────

export interface Session {
  id: string;
  createdAt: number;
  closedAt?: number;
}

interface SessionState extends Session {
  sequence: number;
}

const sessions = new Map<string, SessionState>();

export function createSession(): Session {
  const session: SessionState = {
    id: randomUUID().slice(0, 8),
    createdAt: Date.now(),
    sequence: 0,
  };
  sessions.set(session.id, session);
  return session;
}

export function closeSession(id: string): boolean {
  const session = sessions.get(id);
  if (!session || session.closedAt) return false;
  session.closedAt = Date.now();
  return true;
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

// Returns next monotonic sequence number for a session (or global fallback)
let globalSequence = 0;
export function nextSequence(sessionId?: string): number {
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (session) {
      session.sequence += 1;
      return session.sequence;
    }
  }
  globalSequence += 1;
  return globalSequence;
}

// ── Annotations ───────────────────────────────────────────────────────────────

export function onCreate(listener: () => void) {
  changeListeners.push(listener);
  return () => { changeListeners = changeListeners.filter(l => l !== listener); };
}

function notifyListeners() {
  for (const listener of changeListeners) listener();
}

export function createAnnotation(input: Omit<Annotation, 'id' | 'status' | 'timestamp' | 'sequence'>): Annotation {
  const annotation: Annotation = {
    ...input,
    id: randomUUID().slice(0, 8),
    status: 'pending',
    timestamp: new Date().toISOString(),
    sequence: nextSequence(input.session),
  };
  annotations.set(annotation.id, annotation);
  notifyListeners();
  return annotation;
}

export function listAnnotations(filter?: { status?: AnnotationStatus }): Annotation[] {
  const all = Array.from(annotations.values());
  if (filter?.status) return all.filter(a => a.status === filter.status);
  return all;
}

export function getAnnotation(id: string): Annotation | undefined {
  return annotations.get(id);
}

export function markSent(ids: string[]): number {
  let count = 0;
  for (const id of ids) {
    const a = annotations.get(id);
    if (a && a.status === 'pending') {
      a.status = 'sent';
      count++;
    }
  }
  return count;
}

/** Back to pending with a new note — the same request, run again */
export function reopenAnnotation(id: string, note: string): Annotation | undefined {
  const annotation = annotations.get(id);
  if (!annotation) return undefined;
  annotation.note = note;
  annotation.status = 'pending';
  annotation.resolvedSummary = undefined;
  notifyListeners();
  return annotation;
}

export function resolveAnnotation(id: string, summary: string): Annotation | undefined {
  const a = annotations.get(id);
  if (!a) return undefined;
  a.status = 'resolved';
  a.resolvedSummary = summary;
  return a;
}

export function clearResolved(): number {
  let count = 0;
  for (const [id, a] of annotations) {
    if (a.status === 'resolved') {
      annotations.delete(id);
      count++;
    }
  }
  return count;
}

export function getStats() {
  const all = Array.from(annotations.values());
  return {
    total: all.length,
    pending: all.filter(a => a.status === 'pending').length,
    sent: all.filter(a => a.status === 'sent').length,
    resolved: all.filter(a => a.status === 'resolved').length,
  };
}
