import { render, screen, fireEvent } from "@testing-library/react";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";

// jsdom does not implement scrollIntoView
window.HTMLElement.prototype.scrollIntoView = jest.fn();

const opts = [
  { code: "A", description: "Alpha" },
  { code: "B", description: "Beta" },
];

test("renders the internal search box by default", async () => {
  render(<SearchableCombobox options={opts} value="" onChange={() => {}} />);
  fireEvent.click(screen.getByRole("button"));
  expect(await screen.findByPlaceholderText(/options/i)).toBeInTheDocument();
});

test("hides the internal search box when enableSearch is false", async () => {
  render(<SearchableCombobox options={opts} value="" onChange={() => {}} enableSearch={false} />);
  fireEvent.click(screen.getByRole("button"));
  await screen.findByRole("listbox");
  expect(screen.queryByPlaceholderText(/options/i)).not.toBeInTheDocument();
});

test("keyboard navigation works when enableSearch is false", async () => {
  const onChange = jest.fn();
  render(<SearchableCombobox options={opts} value="" onChange={onChange} enableSearch={false} />);
  fireEvent.click(screen.getByRole("button"));
  const listbox = await screen.findByRole("listbox");
  expect(listbox).toHaveAttribute("tabindex", "0");
  fireEvent.keyDown(listbox, { key: "ArrowDown" });
  fireEvent.keyDown(listbox, { key: "Enter" });
  expect(onChange).toHaveBeenCalledWith("B");
});
