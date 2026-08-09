import type { TableMatrix } from "./holdings-parser";

export const MAX_CDSL_CSV_BYTES = 10 * 1024 * 1024;
const MAX_CSV_ROWS = 5_000;
const MAX_CSV_COLUMNS = 100;
const MAX_CSV_FIELD_LENGTH = 32_000;

export function parseCdslHoldingsCsv(bytes: Uint8Array): TableMatrix {
  if (!bytes.length) throw new Error("CDSL_CSV_EMPTY");
  if (bytes.length > MAX_CDSL_CSV_BYTES) {
    throw new Error("CDSL_CSV_TOO_LARGE");
  }

  const text = decodeCsv(bytes);
  if (text.includes("\0")) throw new Error("CDSL_CSV_INVALID_ENCODING");
  const rows = parseCsvDocument(text);
  const headerIndex = rows.findIndex((row) => {
    const headers = row.map(normalizeHeader);
    return (
      headers.some((header) => header === "isin") &&
      headers.some((header) => header.includes("holding value"))
    );
  });
  if (headerIndex < 0) throw new Error("CDSL_CSV_HOLDINGS_HEADER_NOT_FOUND");

  const headers = rows[headerIndex];
  const isinIndex = headers.map(normalizeHeader).findIndex((cell) => cell === "isin");
  const dataRows = rows
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => cell.trim().length > 0));
  if (
    isinIndex < 0 ||
    !dataRows.some((row) =>
      /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(
        (row[isinIndex] ?? "").replace(/\s+/g, "").toUpperCase(),
      ),
    )
  ) {
    throw new Error("CDSL_CSV_HOLDINGS_ROWS_NOT_FOUND");
  }

  return { headers, rows: dataRows };
}

export function extractCdslCsvAsOfDate(matrix: TableMatrix): string | null {
  const index = matrix.headers.findIndex(
    (header) =>
      header.replace(/\s+/g, " ").trim().toLowerCase() === "as of date",
  );
  if (index < 0) return null;

  const dates = new Set<string>();
  for (const row of matrix.rows) {
    const value = row[index]?.trim();
    if (!value) continue;
    const parsed = parseCdslDate(value);
    if (!parsed) throw new Error("CDSL_CSV_INVALID_AS_OF_DATE");
    dates.add(parsed);
  }
  if (!dates.size) return null;
  if (dates.size > 1) throw new Error("CDSL_CSV_AS_OF_DATE_MISMATCH");
  return [...dates][0];
}

export function parseCsvDocument(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const pushField = () => {
    if (field.length > MAX_CSV_FIELD_LENGTH) {
      throw new Error("CDSL_CSV_FIELD_TOO_LARGE");
    }
    row.push(field);
    field = "";
    if (row.length > MAX_CSV_COLUMNS) {
      throw new Error("CDSL_CSV_TOO_MANY_COLUMNS");
    }
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
    if (rows.length > MAX_CSV_ROWS) throw new Error("CDSL_CSV_TOO_MANY_ROWS");
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      if (field.length) throw new Error("CDSL_CSV_INVALID_QUOTING");
      quoted = true;
    } else if (character === ",") {
      pushField();
    } else if (character === "\n") {
      pushRow();
    } else if (character === "\r") {
      if (input[index + 1] === "\n") index += 1;
      pushRow();
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("CDSL_CSV_UNTERMINATED_QUOTE");
  if (field.length || row.length) pushRow();
  return rows;
}

function decodeCsv(bytes: Uint8Array): string {
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2));
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return new TextDecoder("utf-16be", { fatal: true }).decode(bytes.subarray(2));
    }
    const offset =
      bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset));
  } catch {
    throw new Error("CDSL_CSV_INVALID_ENCODING");
  }
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseCdslDate(value: string): string | null {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return validIsoDate(iso[1], iso[2], iso[3]);

  const numeric = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (numeric) {
    return validIsoDate(
      numeric[3],
      numeric[2].padStart(2, "0"),
      numeric[1].padStart(2, "0"),
    );
  }

  const textual = value.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,9})[-/\s](\d{4})$/);
  if (!textual) return null;
  const month = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ].indexOf(textual[2].slice(0, 3).toLowerCase());
  if (month < 0) return null;
  return validIsoDate(
    textual[3],
    String(month + 1).padStart(2, "0"),
    textual[1].padStart(2, "0"),
  );
}

function validIsoDate(year: string, month: string, day: string): string | null {
  const candidate = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  if (
    Number.isNaN(candidate.getTime()) ||
    candidate.getUTCFullYear() !== Number(year) ||
    candidate.getUTCMonth() + 1 !== Number(month) ||
    candidate.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return `${year}-${month}-${day}`;
}
