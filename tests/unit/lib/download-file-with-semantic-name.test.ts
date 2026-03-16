import { downloadFileWithSemanticName } from "@/lib/files/download-file-with-semantic-name";

describe("downloadFileWithSemanticName", () => {
  const originalFetch = global.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    URL.createObjectURL = jest.fn(() => "blob:semantic-download");
    URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    jest.restoreAllMocks();
  });

  test("keeps the source extension for pdf files", async () => {
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    global.fetch = jest.fn(
      async () =>
        new Response(new Blob(["pdf-content"], { type: "application/pdf" }), {
          status: 200,
        }),
    ) as unknown as typeof fetch;

    await downloadFileWithSemanticName(
      "https://example.com/storage/claims/receipt-file.pdf?token=abc",
      "CLM-001-EXP",
    );

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy.mock.instances[0]?.download).toBe("CLM-001-EXP.pdf");
  });

  test("falls back to blob mime extension when url has no extension", async () => {
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    global.fetch = jest.fn(
      async () =>
        new Response(new Blob(["image-content"], { type: "image/png" }), {
          status: 200,
        }),
    ) as unknown as typeof fetch;

    await downloadFileWithSemanticName(
      "https://example.com/storage/claims/signed-resource",
      "CLM-002-BNK",
    );

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy.mock.instances[0]?.download).toBe("CLM-002-BNK.png");
  });
});
