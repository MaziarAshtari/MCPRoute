export interface SourceLine {
  /** 1-based line number in the original input. */
  line: number;
  value: string;
}

export interface BulkLineError {
  line: number;
  message: string;
}

/** Splits bulk input into trimmed lines, skipping blank lines and `#` comments. */
export function splitBulkLines(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  text.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const value = raw.trim();
    if (value === '' || value.startsWith('#')) return;
    lines.push({ line: index + 1, value });
  });
  return lines;
}
