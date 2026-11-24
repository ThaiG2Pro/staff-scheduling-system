/**
 * @file Low-level RFC 4180 CSV tokenizer.
 * Provides `parseRfc4180Rows` handling UTF-8 BOM, CRLF/LF, quoted commas,
 * escaped quotes (`""`), multiline detection, and trailing empty-line trimming.
 */

import type { CsvParseError } from './types';

export interface ParsedCsvCell {
  value: string;
  hasMultiline: boolean;
}

export interface ParsedCsvRow {
  rowNumber: number;
  cells: ParsedCsvCell[];
}

function consumeQuotedField(
  text: string,
  startIdx: number,
  rowStartLine: number,
  colIndex: number,
  lineNumber: number,
):
  | { ok: true; cell: ParsedCsvCell; nextIdx: number; nextLine: number }
  | { ok: false; error: CsvParseError } {
  let i = startIdx + 1;
  let value = '';
  let hasMultiline = false;
  let currentLine = lineNumber;

  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      if (i + 1 < text.length && text[i + 1] === '"') {
        value += '"';
        i += 2;
        continue;
      }
      return {
        ok: true,
        cell: { value, hasMultiline },
        nextIdx: i + 1,
        nextLine: currentLine,
      };
    }

    if (ch === '\r') {
      hasMultiline = true;
      value += '\n';
      i += i + 1 < text.length && text[i + 1] === '\n' ? 2 : 1;
      currentLine += 1;
    } else if (ch === '\n') {
      hasMultiline = true;
      value += '\n';
      i += 1;
      currentLine += 1;
    } else {
      value += ch;
      i += 1;
    }
  }

  return {
    ok: false,
    error: {
      row: rowStartLine,
      column: colIndex,
      message: 'Unclosed quoted field in CSV.',
    },
  };
}

function consumeUnquotedField(
  text: string,
  startIdx: number,
  rowStartLine: number,
  colIndex: number,
): { ok: true; cell: ParsedCsvCell; nextIdx: number } | { ok: false; error: CsvParseError } {
  let i = startIdx;
  let value = '';

  while (i < text.length) {
    const ch = text[i];
    if (ch === ',' || ch === '\n' || ch === '\r') {
      break;
    }
    if (ch === '"') {
      return {
        ok: false,
        error: {
          row: rowStartLine,
          column: colIndex,
          message: 'Unexpected quote character inside unquoted CSV field.',
        },
      };
    }
    value += ch;
    i += 1;
  }

  return { ok: true, cell: { value, hasMultiline: false }, nextIdx: i };
}

/**
 * Parses raw CSV text according to RFC 4180 (handles UTF-8 BOM, CRLF/LF,
 * quoted commas, escaped quotes, and strips trailing completely empty rows).
 *
 * @param rawText - Raw CSV string.
 * @returns Parsed rows with 1-based physical line numbers, or structured syntax errors.
 */
export function parseRfc4180Rows(
  rawText: string,
): { ok: true; rows: ParsedCsvRow[] } | { ok: false; errors: CsvParseError[] } {
  const text = rawText.startsWith('\uFEFF') ? rawText.slice(1) : rawText;
  const rows: ParsedCsvRow[] = [];

  let i = 0;
  let lineNumber = 1;

  while (i < text.length) {
    const rowStartLine = lineNumber;
    const cells: ParsedCsvCell[] = [];

    while (true) {
      if (i < text.length && text[i] === '"') {
        const res = consumeQuotedField(text, i, rowStartLine, cells.length + 1, lineNumber);
        if (!res.ok) return { ok: false, errors: [res.error] };
        cells.push(res.cell);
        i = res.nextIdx;
        lineNumber = res.nextLine;
      } else {
        const res = consumeUnquotedField(text, i, rowStartLine, cells.length + 1);
        if (!res.ok) return { ok: false, errors: [res.error] };
        cells.push(res.cell);
        i = res.nextIdx;
      }

      if (i < text.length && text[i] === ',') {
        i += 1;
        continue;
      }
      if (i < text.length && text[i] === '\r') {
        i += i + 1 < text.length && text[i + 1] === '\n' ? 2 : 1;
        lineNumber += 1;
        break;
      }
      if (i < text.length && text[i] === '\n') {
        i += 1;
        lineNumber += 1;
        break;
      }
      if (i >= text.length) {
        break;
      }

      return {
        ok: false,
        errors: [
          {
            row: rowStartLine,
            column: cells.length,
            message: 'Unexpected character after closing quote in CSV.',
          },
        ],
      };
    }

    rows.push({ rowNumber: rowStartLine, cells });
  }

  while (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (!last || !last.cells.every((c) => c.value.trim() === '')) break;
    rows.pop();
  }

  return { ok: true, rows };
}
