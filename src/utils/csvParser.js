import { parse } from "csv-parse/sync";

export function parseCsv(csvText) {
  return parse(csvText, {
    columns: (header) =>
      header.map((h) =>
        h.replace(/\r/g, "").replace(/\n/g, "").trim()
      ),
    skip_empty_lines: true,
    trim: true,
    bom: true
  });
}