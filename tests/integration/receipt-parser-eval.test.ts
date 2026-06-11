/** @jest-environment node */
// Live eval against real Gemini using real sample documents.
// Auto-skips when fixtures or GEMINI_API_KEY are absent.
import fs from "node:fs";
import path from "node:path";

const FIXTURES_DIR = path.join(process.cwd(), "tests", "fixtures", "receipts");
const EXPECTED_PATH = path.join(FIXTURES_DIR, "expected.json");
const RUNNABLE = fs.existsSync(EXPECTED_PATH) && Boolean(process.env.GEMINI_API_KEY);

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

type Sample = {
  file: string;
  documentType?: "bank_statement";
  categoryNames?: string[];
  matchHints?: Record<string, string>;
  expect: Record<string, string | number | null>;
};

const describeEval = RUNNABLE ? describe : describe.skip;

describeEval("receipt parser eval (live Gemini)", () => {
  jest.setTimeout(300_000);

  test("extracts expected fields from real sample documents", async () => {
    const samples: Sample[] = JSON.parse(fs.readFileSync(EXPECTED_PATH, "utf8"));
    const { parseReceiptAction } = await import("@/modules/claims/actions/parse-receipt");

    const rows: Array<Record<string, unknown>> = [];
    let checks = 0;
    let hits = 0;

    for (const sample of samples) {
      const filePath = path.join(FIXTURES_DIR, sample.file);
      const mime = MIME_BY_EXT[path.extname(sample.file).toLowerCase()];
      const buffer = fs.readFileSync(filePath);

      const formData = new FormData();
      formData.append("receiptFile", new File([buffer], sample.file, { type: mime }));
      for (const name of sample.categoryNames ?? []) {
        formData.append("expenseCategoryNames", name);
      }
      if (sample.documentType === "bank_statement") {
        formData.append("documentType", "bank_statement");
      }
      for (const [key, value] of Object.entries(sample.matchHints ?? {})) {
        formData.append(key, value);
      }

      const result = await parseReceiptAction(formData);

      for (const [field, expectedValue] of Object.entries(sample.expect)) {
        checks += 1;
        const actual = (result.data as Record<string, unknown> | null)?.[field] ?? null;
        const ok = actual === expectedValue;
        if (ok) hits += 1;
        rows.push({ file: sample.file, field, expected: expectedValue, actual, ok });
      }
    }

    console.table(rows);
    const accuracy = checks === 0 ? 1 : hits / checks;
    console.log(`Field accuracy: ${(accuracy * 100).toFixed(1)}% (${hits}/${checks})`);

    expect(accuracy).toBeGreaterThanOrEqual(0.9);
  });
});
