// src/lib/jobs/runningJobs.ts
// Shared in-memory guard preventing the same job from being processed by two
// concurrent `processJob` calls (e.g. a batch run and a single-image retry).
const runningJobs = new Set<string>();

export function isRunning(jobId: string): boolean {
  return runningJobs.has(jobId);
}

export function start(jobId: string): void {
  runningJobs.add(jobId);
}

export function finish(jobId: string): void {
  runningJobs.delete(jobId);
}
