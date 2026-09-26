/**
 * Postgres rejects some Unicode escapes (especially \u0000 null bytes)
 * that often appear in PDF-extracted text.
 */
export function sanitizeForPostgres(input: string): string {
  return input
    .replace(/\u0000/g, '')
    // Other C0 controls except tab/newline/carriage return
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    // Lone surrogates can also break JSON transport
    .replace(/[\uD800-\uDFFF]/g, '')
}
