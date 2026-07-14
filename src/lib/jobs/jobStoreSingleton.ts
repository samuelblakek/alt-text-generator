// src/lib/jobs/jobStoreSingleton.ts
import { db } from '../db';
import { createJobStore } from './jobStore';

export const jobStore = createJobStore(db);
