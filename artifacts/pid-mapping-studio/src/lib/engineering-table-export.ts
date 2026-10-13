import { FIELD_LABELS, getEngineeringTableValue, serializeEngineeringCsv } from './engineering-data';
import type { EngineeringTableField, EngineeringRow } from './engineering-data';

/** A snapshot of the displayed table, without selection inputs or pagination. */
export type EngineeringTableView = {
  fields: readonly EngineeringTableField[];
  rows: readonly EngineeringRow[];
  groups: readonly EngineeringTableField[];
};
export type EngineeringExportContext = {
  discipline: string;
  drawing: string;
  revision?: string;
  filter: string;
  search: string;
  sort: string;
};

export function engineeringTableValues(view: EngineeringTableView) {
  return {
    headers: ['#', 'Object type', ...view.fields.map((field) => FIELD_LABELS[field])],
    rows: view.rows.map((row, index) => [index + 1, row.type, ...view.fields.map((field) => getEngineeringTableValue(row, field))]),
  };
}

export function engineeringGroupSummary(view: EngineeringTableView) {
  return view.groups.map((field) => {
    const counts = new Map<string, number>();
    for (const row of view.rows) {
      const value = getEngineeringTableValue(row, field) || '—';
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return { field, label: FIELD_LABELS[field], values: [...counts].map(([value, count]) => ({ value, count })) };
  });
}

export function engineeringViewCsv(view: EngineeringTableView) {
  const table = engineeringTableValues(view);
  return serializeEngineeringCsv(table.headers, table.rows);
}

export async function engineeringViewExcel(view: EngineeringTableView, context: EngineeringExportContext) {
  // Loaded only on export; no server upload of private engineering data.
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'gaurav.cbiindia';
  const sheet = workbook.addWorksheet('Engineering data', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const table = engineeringTableValues(view);
  const summaries = engineeringGroupSummary(view);
  const width = table.headers.length;
  const information = [
    'Engineering Data Editor',
    `${context.discipline} · ${context.drawing}${context.revision ? ` · ${context.revision}` : ''} · ${view.rows.length} records`,
    `Object type: ${context.filter} · Search: ${context.search || '(none)'} · Sort: ${context.sort}`,
    ...summaries.map((group) => {
      const summary = group.values.map(({ value, count }) => `${value} (${count})`).join(' · ');
      return `${group.label}: ${summary.length > 1500 ? summary.slice(0, 1500) + '… (see Group summaries sheet)' : summary}`;
    }),
  ];
  information.forEach((text, index) => {
    const row = sheet.addRow([text]);
    sheet.mergeCells(row.number, 1, row.number, width);
    row.height = index === 0 ? 30 : 32;
    row.getCell(1).font = { name: 'Calibri', size: index === 0 ? 16 : 10, bold: index === 0, color: { argb: index === 0 ? 'FFF0F0E8' : 'FF405A55' } };
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index === 0 ? 'FF203940' : 'FFF9F8F2' } };
    row.getCell(1).alignment = { vertical: 'middle', wrapText: true };
  });
  const header = sheet.addRow(table.headers);
  header.height = 30;
  header.eachCell((cell) => {
    cell.font = { name: 'Calibri', bold: true, size: 10, color: { argb: 'FF405A55' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F1E9' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFD9DED5' } } };
  });
  table.rows.forEach((values, index) => {
    const row = sheet.addRow(values);
    row.height = 30;
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      // Explicit strings (including "=...") are text, never spreadsheet formulas.
      cell.numFmt = column === 1 ? '0' : '@';
      cell.font = { name: column > 2 && view.fields[column - 3] === 'itemTag' ? 'Consolas' : 'Calibri', size: 10, color: { argb: 'FF405A55' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 ? 'FFF2F5EE' : 'FFFBFAF6' } };
      cell.border = { right: { style: 'thin', color: { argb: 'FFECEEE8' } }, bottom: { style: 'thin', color: { argb: 'FFE7E9E2' } } };
    });
  });
  sheet.columns.forEach((column, index) => {
    const field = view.fields[index - 2];
    column.width = index === 0 ? 7 : index === 1 ? 18 : field === 'notes' ? 52 : field === 'description' || field === 'connection' ? 38 : Math.max(18, table.headers[index].length + 3);
  });
  sheet.views = [{ state: 'frozen', ySplit: header.number, xSplit: 2 }];
  sheet.autoFilter = { from: { row: header.number, column: 1 }, to: { row: header.number + table.rows.length, column: width } };
  sheet.pageSetup.printTitlesRow = `${header.number}:${header.number}`;
  sheet.headerFooter.oddFooter = '© gaurav.cbiindia | &P of &N';
  if (summaries.length) {
    const groups = workbook.addWorksheet('Group summaries');
    groups.columns = [{ header: 'Group field', width: 25 }, { header: 'Value', width: 42 }, { header: 'Records', width: 12 }];
    summaries.forEach((group) => group.values.forEach(({ value, count }) => groups.addRow([group.label, value, count])));
    groups.getRow(1).font = { bold: true };
    groups.views = [{ state: 'frozen', ySplit: 1 }];
    groups.autoFilter = 'A1:C1';
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
