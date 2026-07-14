import { describe, it, expect } from 'vitest';
import { buildExportCsv, type ExportImageInput } from '../../../src/lib/csv/buildExport';

function image(overrides: Partial<ExportImageInput>): ExportImageInput {
  return {
    sku: 'SKU1',
    productName: 'Widget',
    imageId: '111',
    imageUrl: 'http://a/1.jpg',
    sortOrder: 0,
    slotIndex: 1,
    finalAltText: 'A red widget on a white background',
    ...overrides,
  };
}

describe('buildExportCsv', () => {
  it('builds a header and row for a single-image product', () => {
    const csv = buildExportCsv([image({})]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('Name,SKU,Image 1 ID,Image 1 File,Image 1 Description,Image 1 Sort Order');
    expect(lines[1]).toBe('Widget,SKU1,111,http://a/1.jpg,A red widget on a white background,0');
  });

  it('sizes the header to the max slot count across all products, not a fixed 13', () => {
    const images: ExportImageInput[] = Array.from({ length: 17 }, (_, i) =>
      image({ imageId: `${i}`, imageUrl: `http://a/${i}.jpg`, slotIndex: i + 1, sortOrder: i })
    );
    const csv = buildExportCsv(images);
    const header = csv.trim().split('\n')[0].split(',');
    expect(header).toHaveLength(2 + 17 * 4);
    expect(header[header.length - 4]).toBe('Image 17 ID');
  });

  it('pads shorter products with empty trailing cells up to the shared max width', () => {
    const images: ExportImageInput[] = [
      image({ sku: 'SKU1', slotIndex: 1 }),
      image({ sku: 'SKU2', slotIndex: 1 }),
      image({ sku: 'SKU2', slotIndex: 2, imageId: '222', imageUrl: 'http://a/2.jpg' }),
    ];
    const csv = buildExportCsv(images);
    const lines = csv.trim().split('\n');
    const sku1Row = lines.find((l) => l.includes('SKU1'))!.split(',');
    expect(sku1Row).toHaveLength(2 + 2 * 4);
    expect(sku1Row[sku1Row.length - 1]).toBe('');
  });

  it('throws if two images in the same product normalize to the same URL path', () => {
    const images: ExportImageInput[] = [
      image({ imageUrl: 'http://a/dup.jpg', slotIndex: 1 }),
      image({ imageUrl: 'https://b.example.com/dup.jpg', slotIndex: 2 }),
    ];
    expect(() => buildExportCsv(images)).toThrow(/Duplicate image path/);
  });
});
