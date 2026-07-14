import { describe, it, expect, beforeEach } from 'vitest';
import { requestStop, clearStop, isStopRequested } from '../../../src/lib/jobs/stopRequests';

describe('stopRequests', () => {
  beforeEach(() => {
    clearStop('job-1');
    clearStop('job-2');
  });

  it('reports false for a job that has never had a stop requested', () => {
    expect(isStopRequested('job-1')).toBe(false);
  });

  it('reports true after requestStop, and only for that job id', () => {
    requestStop('job-1');
    expect(isStopRequested('job-1')).toBe(true);
    expect(isStopRequested('job-2')).toBe(false);
  });

  it('reports false again after clearStop', () => {
    requestStop('job-1');
    clearStop('job-1');
    expect(isStopRequested('job-1')).toBe(false);
  });
});
