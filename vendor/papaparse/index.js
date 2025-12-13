export function parse(input, config = {}) {
  const delimiter = config.delimiter || ',';
  const lines = String(input).split(/\r?\n/);
  const skipEmptyLines = config.skipEmptyLines !== false;
  const rows = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (skipEmptyLines && line.trim() === '') continue;
    rows.push(splitLine(line, delimiter));
  }

  if (config.header) {
    const [header, ...dataRows] = rows;
    const data = dataRows.map((row) => {
      const obj = {};
      header.forEach((key, idx) => {
        obj[key] = row[idx] ?? '';
      });
      return obj;
    });
    return { data, meta: { fields: header } };
  }

  return { data: rows };
}

function splitLine(line, delimiter) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}
