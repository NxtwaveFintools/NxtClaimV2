import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useSessionStorage } from "@/hooks/use-session-storage";

function SessionStorageHarness(props: { storageKey: string; initialValue: string }) {
  const [value, setValue] = useSessionStorage(props.storageKey, props.initialValue);

  return (
    <div>
      <span data-testid="value">{value}</span>
      <button type="button" onClick={() => setValue("updated")}>
        Update
      </button>
      <button type="button" onClick={() => setValue((previous) => `${previous}-next`)}>
        Functional Update
      </button>
    </div>
  );
}

describe("useSessionStorage", () => {
  beforeEach(() => {
    sessionStorage.clear();
    jest.restoreAllMocks();
  });

  test("restores value from sessionStorage on mount", async () => {
    sessionStorage.setItem("session:key", JSON.stringify("restored"));

    render(<SessionStorageHarness storageKey="session:key" initialValue="initial" />);

    await waitFor(() => {
      expect(screen.getByTestId("value")).toHaveTextContent("restored");
    });
  });

  test("persists updates to sessionStorage", async () => {
    render(<SessionStorageHarness storageKey="session:key" initialValue="initial" />);

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => {
      expect(sessionStorage.getItem("session:key")).toBe(JSON.stringify("updated"));
    });
  });

  test("supports functional state updates", async () => {
    render(<SessionStorageHarness storageKey="session:key" initialValue="initial" />);

    fireEvent.click(screen.getByRole("button", { name: "Functional Update" }));

    await waitFor(() => {
      expect(screen.getByTestId("value")).toHaveTextContent("initial-next");
    });

    expect(sessionStorage.getItem("session:key")).toBe(JSON.stringify("initial-next"));
  });

  test("keeps initial value when sessionStorage contains invalid JSON", async () => {
    sessionStorage.setItem("session:key", "{");

    render(<SessionStorageHarness storageKey="session:key" initialValue="initial" />);

    await waitFor(() => {
      expect(screen.getByTestId("value")).toHaveTextContent("initial");
    });
  });

  test("keeps initial value when storage read throws", async () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    render(<SessionStorageHarness storageKey="session:key" initialValue="initial" />);

    await waitFor(() => {
      expect(screen.getByTestId("value")).toHaveTextContent("initial");
    });
  });
});
