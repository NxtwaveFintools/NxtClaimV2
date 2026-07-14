export function sanitizeFileName(fileName: string): string {
  const normalized = fileName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "_");
  return normalized || "attachment";
}

/** Inserts "-{suffix}" before the file extension, e.g. ("invoice.pdf", "pr-1") -> "invoice-pr-1.pdf". */
export function insertSuffixBeforeExtension(fileName: string, suffix: string): string {
  const lastDotIndex = fileName.lastIndexOf(".");
  if (lastDotIndex <= 0) return `${fileName}-${suffix}`;
  return `${fileName.slice(0, lastDotIndex)}-${suffix}${fileName.slice(lastDotIndex)}`;
}
