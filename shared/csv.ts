/** A CSV cell that is quoted, and defanged so a spreadsheet will not run it as a formula (=, +, -, @ at the start). */
export function csvCell(v: string): string {
  const t = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${t.replace(/"/g, '""')}"`;
}
