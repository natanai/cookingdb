import fs from 'node:fs';
import Papa from 'papaparse';

// One strict parser for canonical sources, including quoted multiline fields.
// papaparse is a required, pinned dependency; never silently fall back to a
// line-oriented parser that can truncate authored directions.
export function parseCSV(content, label = 'CSV') {
  const parsed = Papa.parse(content, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) {
    const error = parsed.errors[0];
    const record = Number.isInteger(error.row) ? ` at data record ${error.row + 1}` : '';
    throw new Error(`CSV parse error in ${label}${record}: ${error.message}`);
  }
  if (Object.keys(parsed.meta.renamedHeaders || {}).length) {
    throw new Error(`CSV parse error in ${label}: duplicate column names`);
  }
  return parsed.data;
}

export function parseCSVFile(filePath, options = {}) {
  return parseCSV(fs.readFileSync(filePath, 'utf8'), options.label || filePath);
}

export function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(headers, rows) {
  return `${[headers, ...rows.map((row) => headers.map((header) => row[header] ?? ''))]
    .map((cells) => cells.map(csvCell).join(','))
    .join('\n')}\n`;
}
