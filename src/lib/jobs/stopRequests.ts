// src/lib/jobs/stopRequests.ts
// Shared in-memory guard for a reviewer-requested stop, mirroring runningJobs.ts.
// A stop only prevents new per-image tasks in processJob from starting; it does
// not abort in-flight fetch/Gemini calls already underway.
const stopRequests = new Set<string>();

export function requestStop(jobId: string): void {
  stopRequests.add(jobId);
}

export function clearStop(jobId: string): void {
  stopRequests.delete(jobId);
}

export function isStopRequested(jobId: string): boolean {
  return stopRequests.has(jobId);
}
