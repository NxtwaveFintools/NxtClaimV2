import { act, render, screen } from "@testing-library/react";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";

// jsdom does not implement scrollIntoView
window.HTMLElement.prototype.scrollIntoView = jest.fn();

const opts = [
  { code: "A", description: "Alpha" },
  { code: "B", description: "Beta" },
];

test("renders the internal search box by default", async () => {
  render(<SearchableCombobox options={opts} value="" onChange={() => {}} />);
  act(() => {
    screen.getByRole("button").click();
  });
  expect(await screen.findByPlaceholderText(/options/i)).toBeInTheDocument();
});

test("hides the internal search box when enableSearch is false", async () => {
  render(<SearchableCombobox options={opts} value="" onChange={() => {}} enableSearch={false} />);
  act(() => {
    screen.getByRole("button").click();
  });
  await screen.findByRole("listbox");
  expect(screen.queryByPlaceholderText(/options/i)).not.toBeInTheDocument();
});
