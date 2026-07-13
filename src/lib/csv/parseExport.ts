import { parse } from 'csv-parse/sync';

export interface ParsedImageRow {
  sku: string;
  productName: string;
  imageId: string;
  imageUrl: string;
  existingDescription: string;
  sortOrder: number;
  slotIndex: number;
}

const COLUMNS_PER_SLOT = 6;
const LEADING_COLUMNS = 3; // SKU, Product ID, Product Name

export function parseExportCsv(csvText: string): ParsedImageRow[] {
  const rows: string[][] = parse(csvText, { skip_empty_lines: true });
  const [, ...dataRows] = rows; // drop header row
  const results: ParsedImageRow[] = [];

  for (const row of dataRows) {
    const sku = row[0]?.trim();
    const productName = row[2]?.trim();
    if (!sku || !productName) continue;

    const slotCount = Math.floor((row.length - LEADING_COLUMNS) / COLUMNS_PER_SLOT);
    for (let slot = 0; slot < slotCount; slot++) {
      const base = LEADING_COLUMNS + slot * COLUMNS_PER_SLOT;
      const imageUrl = row[base + 1]?.trim();
      if (!imageUrl) continue;
      const imageId = row[base + 2]?.trim() ?? '';
      const existingDescription = row[base + 4]?.trim() ?? '';
      const sortOrderRaw = row[base + 5]?.trim();
      const sortOrder =
        sortOrderRaw && !Number.isNaN(Number(sortOrderRaw)) ? Number(sortOrderRaw) : slot;

      results.push({
        sku,
        productName,
        imageId,
        imageUrl,
        existingDescription,
        sortOrder,
        slotIndex: slot + 1,
      });
    }
  }

  return results;
}
