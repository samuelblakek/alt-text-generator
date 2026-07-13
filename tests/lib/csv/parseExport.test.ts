import { describe, it, expect } from 'vitest';
import { parseExportCsv } from '../../../src/lib/csv/parseExport';

function makeSlot(url: string, id: string, description: string, sort: number): string {
  return `file.jpg,${url},${id},d/1/file.jpg,${description},${sort}`;
}

describe('parseExportCsv', () => {
  it('flattens a product with two image slots into two rows', () => {
    const header = 'Product Code/SKU,Product ID,Product Name,' +
      'Product Image File - 1,Product Image URL - 1,Product Image ID - 1,Product Image File - 1,Product Image Description - 1,Product Image Sort - 1,' +
      'Product Image File - 2,Product Image URL - 2,Product Image ID - 2,Product Image File - 2,Product Image Description - 2,Product Image Sort - 2';
    const row = `SKU1,1,Widget,${makeSlot('http://a/1.jpg', '111', 'Widget', 0)},${makeSlot('http://a/2.jpg', '112', 'Widget side', 1)}`;
    const rows = parseExportCsv(`${header}\n${row}\n`);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      sku: 'SKU1',
      productName: 'Widget',
      imageId: '111',
      imageUrl: 'http://a/1.jpg',
      existingDescription: 'Widget',
      sortOrder: 0,
      slotIndex: 1,
    });
    expect(rows[1].slotIndex).toBe(2);
    expect(rows[1].imageUrl).toBe('http://a/2.jpg');
  });

  it('skips slots with no URL', () => {
    const header = 'Product Code/SKU,Product ID,Product Name,' +
      'Product Image File - 1,Product Image URL - 1,Product Image ID - 1,Product Image File - 1,Product Image Description - 1,Product Image Sort - 1,' +
      'Product Image File - 2,Product Image URL - 2,Product Image ID - 2,Product Image File - 2,Product Image Description - 2,Product Image Sort - 2';
    const row = `SKU1,1,Widget,${makeSlot('http://a/1.jpg', '111', 'Widget', 0)},,,,,,`;
    const rows = parseExportCsv(`${header}\n${row}\n`);
    expect(rows).toHaveLength(1);
  });

  it('handles a product with more than 13 image slots', () => {
    const slotCount = 15;
    const headerSlots = Array.from({ length: slotCount }, (_, i) =>
      `Product Image File - ${i + 1},Product Image URL - ${i + 1},Product Image ID - ${i + 1},Product Image File - ${i + 1},Product Image Description - ${i + 1},Product Image Sort - ${i + 1}`
    ).join(',');
    const header = `Product Code/SKU,Product ID,Product Name,${headerSlots}`;
    const dataSlots = Array.from({ length: slotCount }, (_, i) =>
      makeSlot(`http://a/${i + 1}.jpg`, `${100 + i}`, 'Widget', i)
    ).join(',');
    const row = `SKU1,1,Widget,${dataSlots}`;
    const rows = parseExportCsv(`${header}\n${row}\n`);
    expect(rows).toHaveLength(15);
    expect(rows[14].slotIndex).toBe(15);
    expect(rows[14].imageUrl).toBe('http://a/15.jpg');
  });

  it('skips rows with no SKU or product name', () => {
    const header = 'Product Code/SKU,Product ID,Product Name';
    const rows = parseExportCsv(`${header}\n,,\n`);
    expect(rows).toHaveLength(0);
  });

  it('parses ragged rows with fewer columns than the header without throwing', () => {
    const header = 'Product Code/SKU,Product ID,Product Name,' +
      'Product Image File - 1,Product Image URL - 1,Product Image ID - 1,Product Image File - 1,Product Image Description - 1,Product Image Sort - 1,' +
      'Product Image File - 2,Product Image URL - 2,Product Image ID - 2,Product Image File - 2,Product Image Description - 2,Product Image Sort - 2';
    // Row with only one image slot (9 columns total: 3 leading + 6 per slot) instead of two
    const row = `SKU2,2,Gadget,${makeSlot('http://a/3.jpg', '222', 'Gadget', 0)}`;
    const rows = parseExportCsv(`${header}\n${row}\n`);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      sku: 'SKU2',
      productName: 'Gadget',
      imageId: '222',
      imageUrl: 'http://a/3.jpg',
      existingDescription: 'Gadget',
      sortOrder: 0,
      slotIndex: 1,
    });
  });
});
