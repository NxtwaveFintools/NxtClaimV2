# Receipt parser eval fixtures

Drop real sample documents here (PDF/JPG/PNG/WEBP) plus an `expected.json`
describing the ground truth. The eval test auto-skips when this folder has no
`expected.json` or when `GEMINI_API_KEY` is not set.

`expected.json` format (only assert the fields you care about):

```json
[
  {
    "file": "swiggy-dinner.jpg",
    "categoryNames": ["Meals", "Travel Domestic"],
    "expect": {
      "transactionDate": "2026-06-01",
      "totalAmount": 1365.4,
      "foreignCurrencyCode": null,
      "vendorName": "Swiggy"
    }
  },
  {
    "file": "hdfc-statement.pdf",
    "documentType": "bank_statement",
    "matchHints": { "bankStatementMatchVendorName": "Adobe" },
    "expect": { "basicAmount": 4250.75 }
  }
]
```

Run with:

```powershell
node --env-file=.env.local node_modules/jest/bin/jest.js --testPathPatterns=tests/integration/receipt-parser-eval --runInBand
```
