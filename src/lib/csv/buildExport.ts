import { stringify } from 'csv-stringify/sync';
import { normalizeUrlPath } from '../urlMatch';

export interface ExportImageInput {
  sku: string;
  productName: string;
  imageId: string;
  imageUrl: string;
  sortOrder: number;
  slotIndex: number;
  finalAltText: string;
}

export function buildExportCsv(images: ExportImageInput[]): string {
  const bySku = new Map<string, ExportImageInput[]>();
  for (const image of images) {
    const list = bySku.get(image.sku) ?? [];
    list.push(image);
    bySku.set(image.sku, list);
  }

  let maxSlots = 0;
  for (const list of bySku.values()) {
    maxSlots = Math.max(maxSlots, list.length);
  }

  const header = ['Name', 'SKU'];
  for (let n = 1; n <= maxSlots; n++) {
    header.push(`Image ${n} ID`, `Image ${n} File`, `Image ${n} Description`, `Image ${n} Sort Order`);
  }

  const rows: (string | number)[][] = [];
  for (const [sku, list] of bySku) {
    const seenPaths = new Set<string>();
    for (const image of list) {
      const imagePath = normalizeUrlPath(image.imageUrl);
      if (seenPaths.has(imagePath)) {
        throw new Error(`Duplicate image path within product ${sku}: ${imagePath}`);
      }
      seenPaths.add(imagePath);
    }

    const sorted = [...list].sort((a, b) => a.slotIndex - b.slotIndex);
    const row: (string | number)[] = [sorted[0].productName, sku];
    for (const image of sorted) {
      row.push(image.imageId, image.imageUrl, image.finalAltText, image.sortOrder);
    }
    while (row.length < 2 + maxSlots * 4) {
      row.push('');
    }
    rows.push(row);
  }

  return stringify([header, ...rows]);
}
