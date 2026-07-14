export type JobStatus = 'pending' | 'processing' | 'complete';
export type ImageStatus = 'pending' | 'processing' | 'done' | 'failed' | 'skipped';

export interface Job {
  id: string;
  createdAt: string;
  sourceFilename: string;
  status: JobStatus;
  imageCount: number;
  doneCount: number;
  failedCount: number;
  skippedCount: number;
}

export interface ValidationFlags {
  wordCountOk: boolean;
  bannedPhrase: boolean;
  isDuplicateOfProductName: boolean;
  isDuplicateWithinProduct: boolean;
}

export interface ImageRecord {
  id: number;
  jobId: string;
  sku: string;
  productName: string;
  imageId: string;
  imageUrl: string;
  existingDescription: string;
  sortOrder: number;
  slotIndex: number;
  status: ImageStatus;
  generatedAltText: string | null;
  editedAltText: string | null;
  validationFlags: ValidationFlags | null;
  error: string | null;
  reviewerHint: string | null;
}
