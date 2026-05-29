import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BcClaimModal } from "@/modules/claims/ui/bc-claim-modal";

// This test LOCKS IN the stale-response cancellation in the HSN/SAC
// search-as-you-type effect of the BC claim modal. The effect uses a
// `cancelled` flag in its cleanup so that an in-flight response for an OLD
// query cannot overwrite state once the query has moved on to a NEWER one.
//
// We force the older request to RESOLVE LAST and assert the rendered HSN/SAC
// options reflect ONLY the newest query — proving the stale response was
// dropped rather than clobbering the latest state.

jest.setTimeout(15000);

// The modal calls supabase.functions.invoke for vendor search and the final
// bc-claim submit, and supabase.auth.getSession inside fetchReference. The
// HSN/SAC reference search itself goes through global fetch() to
// /functions/v1/bc-reference, which is the boundary we control below.
const mockInvoke = jest.fn();
const mockGetSession = jest.fn();

jest.mock("@/core/infra/supabase/browser-client", () => ({
  getBrowserSupabaseClient: () => ({
    auth: { getSession: () => mockGetSession() },
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  }),
}));

type Deferred = {
  promise: Promise<Response>;
  resolve: (res: Response) => void;
};

function deferred(): Deferred {
  let resolve!: (res: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Build a fetch Response stub carrying a bc-reference payload. */
function referenceResponse(options: { code: string; description: string }[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ value: options }),
  } as unknown as Response;
}

function renderModal() {
  return render(
    <BcClaimModal open onOpenChange={() => {}} claimId="claim-1" onSuccess={() => {}} />,
  );
}

describe("BcClaimModal — HSN/SAC stale-response cancellation", () => {
  beforeAll(() => {
    // jsdom doesn't implement scrollIntoView, which the combobox calls when opened.
    Element.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "token-123" } } });
    // currencies + gstGroups are eagerly fetched on Vendor toggle; keep them
    // resolved so they don't interfere. They never match the HSN query asserts.
    mockInvoke.mockResolvedValue({ data: { vendors: [] }, error: null });
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  test("late-arriving response for the OLD query does not overwrite the NEW query's options", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    // Per-query deferred fetch results. fetchReference appends type+query to
    // the URL; we route HSN/SAC requests by the `query` param.
    const dOld = deferred(); // for query "99"
    const dNew = deferred(); // for query "996"

    const fetchMock = jest.fn((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      const query = new URL(url).searchParams.get("query");
      if (query === "99") return dOld.promise;
      if (query === "996") return dNew.promise;
      // currencies / gstGroupCodes (no query param) — resolve immediately empty.
      return Promise.resolve(referenceResponse([]));
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderModal();

    await user.click(screen.getByRole("button", { name: /pay a third-party vendor/i }));

    const hsnInput = await screen.findByPlaceholderText(/type to search hsn\/sac codes/i);

    // Type the first (older) query and flush the 300ms debounce → fires fetch#1.
    await user.type(hsnInput, "99");
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("query=99&"))).toBe(true);

    // Extend to the newer query and flush the debounce again → fires fetch#2.
    await user.type(hsnInput, "6");
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("query=996&"))).toBe(true);

    // OUT-OF-ORDER RESOLUTION: the NEWER request resolves FIRST...
    await act(async () => {
      dNew.resolve(referenceResponse([{ code: "996511", description: "NEW courier services" }]));
      await dNew.promise;
    });
    // ...then the OLDER request resolves LAST (the stale one).
    await act(async () => {
      dOld.resolve(referenceResponse([{ code: "9988", description: "OLD stale services" }]));
      await dOld.promise;
    });

    // The HSN/SAC combobox should now reflect ONLY the newest query's option.
    // Open the loaded combobox (trigger placeholder "Select hsn / sac…").
    const trigger = await screen.findByRole("button", { name: /select hsn \/ sac…/i });
    await user.click(trigger);

    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByText("996511")).toBeInTheDocument();
    // The stale older response must NOT have overwritten state.
    expect(within(listbox).queryByText("9988")).not.toBeInTheDocument();
    expect(screen.queryByText("OLD stale services")).not.toBeInTheDocument();
  });
});
