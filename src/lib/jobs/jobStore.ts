// src/lib/jobs/jobStore.ts
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { ParsedImageRow } from '../csv/parseExport';
import { validateAltText, computeDuplicateWithinProduct } from '../validator/validateAltText';
import type { Job, ImageRecord, ValidationFlags, JobStatus, ImageStatus } from '../../types';
import { DEFAULT_MODEL } from '../gemini/models';

interface ImageRow {
  id: number;
  job_id: string;
  sku: string;
  product_name: string;
  image_id: string;
  image_url: string;
  existing_description: string | null;
  sort_order: number;
  slot_index: number;
  status: ImageStatus;
  generated_alt_text: string | null;
  edited_alt_text: string | null;
  validation_flags: string | null;
  error: string | null;
  reviewer_hint: string | null;
}

interface JobRow {
  id: string;
  created_at: string;
  source_filename: string;
  model: string;
  status: JobStatus;
  image_count: number;
  done_count: number;
  failed_count: number;
  skipped_count: number;
}

function rowToImageRecord(row: ImageRow): ImageRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    sku: row.sku,
    productName: row.product_name,
    imageId: row.image_id,
    imageUrl: row.image_url,
    existingDescription: row.existing_description ?? '',
    sortOrder: row.sort_order,
    slotIndex: row.slot_index,
    status: row.status,
    generatedAltText: row.generated_alt_text,
    editedAltText: row.edited_alt_text,
    validationFlags: row.validation_flags ? JSON.parse(row.validation_flags) : null,
    error: row.error,
    reviewerHint: row.reviewer_hint ?? null,
  };
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    createdAt: row.created_at,
    sourceFilename: row.source_filename,
    model: row.model,
    status: row.status,
    imageCount: row.image_count,
    doneCount: row.done_count,
    failedCount: row.failed_count,
    skippedCount: row.skipped_count,
  };
}

export function createJobStore(db: Database.Database) {
  function createJob(sourceFilename: string, rows: ParsedImageRow[], model: string = DEFAULT_MODEL): Job {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    const insertJob = db.prepare(
      `INSERT INTO jobs (id, created_at, source_filename, model, status, image_count, done_count, failed_count, skipped_count)
       VALUES (?, ?, ?, ?, 'pending', ?, 0, 0, 0)`
    );
    const insertImage = db.prepare(
      `INSERT INTO image_records
         (job_id, sku, product_name, image_id, image_url, existing_description, sort_order, slot_index, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    );

    const tx = db.transaction(() => {
      insertJob.run(id, createdAt, sourceFilename, model, rows.length);
      for (const row of rows) {
        insertImage.run(
          id,
          row.sku,
          row.productName,
          row.imageId,
          row.imageUrl,
          row.existingDescription,
          row.sortOrder,
          row.slotIndex
        );
      }
    });
    tx();

    return getJob(id) as Job;
  }

  function getJob(jobId: string): Job | undefined {
    const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId) as JobRow | undefined;
    return row ? rowToJob(row) : undefined;
  }

  function getImages(jobId: string): ImageRecord[] {
    const rows = db
      .prepare(`SELECT * FROM image_records WHERE job_id = ? ORDER BY sku, slot_index`)
      .all(jobId) as ImageRow[];
    return rows.map(rowToImageRecord);
  }

  function getPendingOrFailedImages(jobId: string): ImageRecord[] {
    const rows = db
      .prepare(
        `SELECT * FROM image_records WHERE job_id = ? AND status IN ('pending', 'failed') ORDER BY sku, slot_index`
      )
      .all(jobId) as ImageRow[];
    return rows.map(rowToImageRecord);
  }

  function resetStaleProcessing(jobId: string): void {
    db.prepare(
      `UPDATE image_records SET status = 'pending' WHERE job_id = ? AND status = 'processing'`
    ).run(jobId);
  }

  function updateImageStatus(
    id: number,
    patch: { status: ImageStatus; generatedAltText?: string | null; error?: string | null }
  ): void {
    db.prepare(
      `UPDATE image_records SET status = ?, generated_alt_text = COALESCE(?, generated_alt_text), error = ?
       WHERE id = ?`
    ).run(patch.status, patch.generatedAltText ?? null, patch.error ?? null, id);
  }

  function setEditedAltText(id: number, editedAltText: string): void {
    db.prepare(`UPDATE image_records SET edited_alt_text = ? WHERE id = ?`).run(editedAltText, id);
  }

  function clearEditedAltText(id: number): void {
    db.prepare(`UPDATE image_records SET edited_alt_text = NULL WHERE id = ?`).run(id);
  }

  function setReviewerHint(id: number, reviewerHint: string): void {
    db.prepare(`UPDATE image_records SET reviewer_hint = ? WHERE id = ?`).run(reviewerHint, id);
  }

  function setValidationFlags(id: number, flags: ValidationFlags): void {
    db.prepare(`UPDATE image_records SET validation_flags = ? WHERE id = ?`).run(
      JSON.stringify(flags),
      id
    );
  }

  function recomputeValidationFlagsForSku(jobId: string, sku: string): void {
    const rows = db
      .prepare(`SELECT * FROM image_records WHERE job_id = ? AND sku = ?`)
      .all(jobId, sku) as ImageRow[];
    const records = rows.map(rowToImageRecord);

    const finalTexts = records.map((r) => ({
      id: r.id,
      text: r.editedAltText ?? r.generatedAltText ?? '',
    }));
    const duplicateMap = computeDuplicateWithinProduct(finalTexts);

    for (const record of records) {
      const finalText = record.editedAltText ?? record.generatedAltText ?? '';
      const base = validateAltText(finalText, record.productName);
      const flags: ValidationFlags = {
        ...base,
        isDuplicateWithinProduct: duplicateMap.get(record.id) ?? false,
      };
      setValidationFlags(record.id, flags);
    }
  }

  function recomputeAllValidationFlags(jobId: string): void {
    const skus = db
      .prepare(`SELECT DISTINCT sku FROM image_records WHERE job_id = ?`)
      .all(jobId) as { sku: string }[];
    for (const { sku } of skus) {
      recomputeValidationFlagsForSku(jobId, sku);
    }
  }

  function recomputeJobTotals(jobId: string): void {
    const counts = db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
           SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped,
           SUM(CASE WHEN status IN ('pending', 'processing', 'failed') THEN 1 ELSE 0 END) as remaining
         FROM image_records WHERE job_id = ?`
      )
      .get(jobId) as { done: number; failed: number; skipped: number; remaining: number };

    const status: JobStatus = counts.remaining > 0 ? 'processing' : 'complete';

    db.prepare(
      `UPDATE jobs SET done_count = ?, failed_count = ?, skipped_count = ?, status = ? WHERE id = ?`
    ).run(counts.done ?? 0, counts.failed ?? 0, counts.skipped ?? 0, status, jobId);
  }

  return {
    createJob,
    getJob,
    getImages,
    getPendingOrFailedImages,
    resetStaleProcessing,
    updateImageStatus,
    setEditedAltText,
    clearEditedAltText,
    setReviewerHint,
    recomputeValidationFlagsForSku,
    recomputeAllValidationFlags,
    recomputeJobTotals,
  };
}

export type JobStore = ReturnType<typeof createJobStore>;
