"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * A small, dependency-free searchable combobox.
 *
 * Why hand-rolled: the repo doesn't carry cmdk or @radix-ui/react-popover.
 * The use-case driving this is the BC HSN/SAC dropdown which returns 16k+
 * items from Business Central — a native <select> would render every option,
 * tanking modal open time. This component:
 *   - filters case-insensitively against `code` AND `description`,
 *   - virtualises the visible list to MAX_VISIBLE matches (default 50),
 *   - supports keyboard navigation (↑ ↓ Enter Esc),
 *   - closes on outside click,
 *   - keeps the modal aesthetic (rounded-xl, indigo focus, zinc borders).
 *
 * For small lists (Currency, GST Group) it behaves like a polished select.
 * For large lists (HSN/SAC) it stays responsive because we never render more
 * than MAX_VISIBLE rows at a time — typing narrows the slice.
 */

export interface ComboboxOption {
  code: string;
  description: string;
}

interface Props {
  options: ComboboxOption[];
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  /** Cap the visible match list. Above this, the dropdown asks the user to keep typing. */
  maxVisible?: number;
}

const DEFAULT_MAX = 50;

export function SearchableCombobox({
  options,
  value,
  onChange,
  placeholder = "Select…",
  emptyText = "No matches",
  disabled = false,
  maxVisible = DEFAULT_MAX,
}: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = useMemo(
    () => (value ? (options.find((o) => o.code === value) ?? null) : null),
    [options, value],
  );

  const filtered = useMemo(() => {
    if (!query) return options.slice(0, maxVisible);
    const q = query.toLowerCase();
    const matches: ComboboxOption[] = [];
    for (const opt of options) {
      if (opt.code.toLowerCase().includes(q) || opt.description.toLowerCase().includes(q)) {
        matches.push(opt);
        if (matches.length >= maxVisible) break;
      }
    }
    return matches;
  }, [options, query, maxVisible]);

  const totalMatches = useMemo(() => {
    if (!query) return options.length;
    const q = query.toLowerCase();
    let count = 0;
    for (const opt of options) {
      if (opt.code.toLowerCase().includes(q) || opt.description.toLowerCase().includes(q)) {
        count += 1;
      }
    }
    return count;
  }, [options, query]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Focus the search input whenever we open.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Reset activeIndex when the filtered slice changes. We intentionally
  // setState in this effect because activeIndex must follow user-driven
  // input changes (query / open) without a hand-rolled controller.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveIndex(0);
  }, [query, open]);

  // Keep active option in view.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-combobox-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function commit(opt: ComboboxOption) {
    onChange(opt.code);
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[activeIndex];
      if (opt) commit(opt);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  const truncatedCount = totalMatches - filtered.length;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled || options.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "nxt-input flex h-9 w-full items-center justify-between gap-2 rounded-xl border border-zinc-300 bg-white px-3 text-left text-sm text-zinc-800 transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-600",
          open && "border-indigo-500 ring-2 ring-indigo-500 ring-offset-2 dark:border-indigo-400",
        )}
      >
        {selected ? (
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="font-mono text-xs text-zinc-900 dark:text-zinc-100">
              {selected.code}
            </span>
            {selected.description && (
              <span className="truncate text-zinc-500 dark:text-zinc-400">
                {selected.description}
              </span>
            )}
          </span>
        ) : (
          <span className="text-zinc-400 dark:text-zinc-500">{placeholder}</span>
        )}
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-zinc-400 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg shadow-zinc-900/5 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/30"
        >
          <div className="relative border-b border-zinc-100 px-2 py-2 dark:border-zinc-800">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={`Search ${options.length.toLocaleString()} options…`}
              className="h-7 w-full rounded-md border-0 bg-transparent pl-7 pr-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-0 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              aria-controls={`${id}-listbox`}
              aria-activedescendant={filtered[activeIndex] ? `${id}-opt-${activeIndex}` : undefined}
            />
          </div>

          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
              {emptyText}
              {query && (
                <span className="block pt-1 text-zinc-400 dark:text-zinc-500">
                  for &ldquo;{query}&rdquo;
                </span>
              )}
            </p>
          ) : (
            <>
              <ul
                ref={listRef}
                id={`${id}-listbox`}
                role="listbox"
                className="max-h-56 overflow-auto py-1"
              >
                {filtered.map((opt, i) => {
                  const isSelected = opt.code === value;
                  const isActive = i === activeIndex;
                  return (
                    <li
                      key={opt.code}
                      id={`${id}-opt-${i}`}
                      data-combobox-index={i}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => commit(opt)}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm transition-colors",
                        isActive
                          ? "bg-indigo-50 dark:bg-indigo-950/40"
                          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60",
                      )}
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                        {isSelected && (
                          <Check className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                        )}
                      </span>
                      <span className="font-mono text-xs text-zinc-900 dark:text-zinc-100">
                        {opt.code}
                      </span>
                      {opt.description && (
                        <span className="min-w-0 flex-1 truncate text-zinc-500 dark:text-zinc-400">
                          {opt.description}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {truncatedCount > 0 && (
                <p className="border-t border-zinc-100 px-3 py-1.5 text-center text-[10px] uppercase tracking-wider text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
                  {truncatedCount.toLocaleString()} more match
                  {truncatedCount === 1 ? "" : "es"} &mdash; keep typing
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
