import { act, renderHook } from "@testing-library/react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

describe("useDebouncedValue", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test("keeps previous value until delay elapses", () => {
    const { result, rerender } = renderHook(
      ({ value, delayMs }) => useDebouncedValue(value, delayMs),
      {
        initialProps: { value: "initial", delayMs: 400 },
      },
    );

    expect(result.current).toBe("initial");

    rerender({ value: "updated", delayMs: 400 });

    expect(result.current).toBe("initial");

    act(() => {
      jest.advanceTimersByTime(399);
    });

    expect(result.current).toBe("initial");

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(result.current).toBe("updated");
  });

  test("cancels pending update when value changes rapidly", () => {
    const { result, rerender } = renderHook(
      ({ value, delayMs }) => useDebouncedValue(value, delayMs),
      {
        initialProps: { value: "a", delayMs: 400 },
      },
    );

    rerender({ value: "b", delayMs: 400 });

    act(() => {
      jest.advanceTimersByTime(200);
    });

    rerender({ value: "c", delayMs: 400 });

    act(() => {
      jest.advanceTimersByTime(399);
    });

    expect(result.current).toBe("a");

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(result.current).toBe("c");
  });
});
