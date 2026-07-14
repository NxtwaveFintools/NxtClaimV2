export const PURCHASE_REQUEST_ATTACHMENT_BUCKET = "purchase-request-attachments";
export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
// Below this, a file is essentially empty/a placeholder (e.g. a 70-byte 1x1 test
// PNG) rather than a real document -- Gemini rejects such files deep in analysis
// with an opaque "document has no pages" error, so reject them at submission
// instead with a clear, immediate 400. Calibrated between observed junk (70-393
// bytes) and the smallest legitimate real document seen so far (~940 bytes for a
// bare-bones text-only PDF) -- not a hard technical minimum, just a heuristic.
export const MIN_ATTACHMENT_SIZE_BYTES = 512;
export const RATE_LIMIT_MAX_REQUESTS_PER_HOUR = 100;
