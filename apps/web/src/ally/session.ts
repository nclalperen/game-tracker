let currentSession: string | null = null;

export function getOrCreateSession(): string {
  if (currentSession) return currentSession;
  currentSession = `sess_${Math.random().toString(36).slice(2, 10)}`;
  return currentSession;
}

export function resetSession() {
  currentSession = null;
}
