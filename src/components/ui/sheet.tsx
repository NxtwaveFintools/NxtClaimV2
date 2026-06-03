"use client";

import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type ClassValue = string | false | null | undefined;

function joinClasses(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}

type SheetContextValue = {
  open: boolean;
  setOpen: (next: boolean) => void;
  contentId: string;
  titleId: string;
  descriptionId: string;
};

const SheetContext = createContext<SheetContextValue | null>(null);

export function useOptionalSheetContext(): SheetContextValue | null {
  return useContext(SheetContext);
}

function useSheetContext(componentName: string): SheetContextValue {
  const context = useContext(SheetContext);
  if (!context) {
    throw new Error(`${componentName} must be used within <Sheet>.`);
  }

  return context;
}

type SheetProps = {
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (next: boolean) => void;
};

export function Sheet({ children, open, defaultOpen = false, onOpenChange }: SheetProps) {
  const generatedId = useId();
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = typeof open === "boolean";

  const resolvedOpen = isControlled ? open : internalOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) {
        setInternalOpen(next);
      }

      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const contextValue = useMemo<SheetContextValue>(
    () => ({
      open: resolvedOpen,
      setOpen,
      contentId: `${generatedId}-content`,
      titleId: `${generatedId}-title`,
      descriptionId: `${generatedId}-description`,
    }),
    [generatedId, resolvedOpen, setOpen],
  );

  return <SheetContext.Provider value={contextValue}>{children}</SheetContext.Provider>;
}

type SheetTriggerProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function SheetTrigger({ type = "button", onClick, ...props }: SheetTriggerProps) {
  const { setOpen } = useSheetContext("SheetTrigger");

  return (
    <button
      {...props}
      type={type}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          setOpen(true);
        }
      }}
    />
  );
}

type SheetPortalProps = {
  children: ReactNode;
};

function SheetPortal({ children }: SheetPortalProps) {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(children, document.body);
}

type SheetContentProps = HTMLAttributes<HTMLDivElement> & {
  side?: "left" | "right";
  hideDefaultCloseButton?: boolean;
};

export function SheetContent({
  className,
  side = "right",
  hideDefaultCloseButton = false,
  children,
  ...props
}: SheetContentProps) {
  const { open, setOpen, contentId, titleId, descriptionId } = useSheetContext("SheetContent");

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);

  if (!open) {
    return null;
  }

  return (
    <SheetPortal>
      <div className="fixed inset-0 z-[120]">
        <button
          type="button"
          className="absolute inset-0 bg-black/30 dark:bg-black/50"
          aria-label="Close panel"
          onClick={() => {
            setOpen(false);
          }}
        />
        <div
          id={contentId}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className={joinClasses(
            "absolute top-0 h-full w-full max-w-md border-border bg-card p-5 shadow-lg shadow-black/5 transition-colors",
            side === "right" ? "right-0 border-l" : "left-0 border-r",
            className,
          )}
          {...props}
        >
          {!hideDefaultCloseButton ? (
            <button
              type="button"
              className="absolute right-4 top-4 z-20 inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:bg-background-secondary"
              aria-label="Close panel"
              onClick={() => {
                setOpen(false);
              }}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="M6 6l12 12" />
                <path d="M18 6 6 18" />
              </svg>
            </button>
          ) : null}
          {children}
        </div>
      </div>
    </SheetPortal>
  );
}

type SheetCloseProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function SheetClose({ type = "button", onClick, ...props }: SheetCloseProps) {
  const context = useContext(SheetContext);

  return (
    <button
      {...props}
      type={type}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          context?.setOpen(false);
        }
      }}
    />
  );
}

type SheetHeaderProps = HTMLAttributes<HTMLDivElement>;

export function SheetHeader({ className, ...props }: SheetHeaderProps) {
  return <div className={joinClasses("mb-4 space-y-1 pr-10", className)} {...props} />;
}

type SheetTitleProps = HTMLAttributes<HTMLHeadingElement>;

export function SheetTitle({ className, ...props }: SheetTitleProps) {
  const { titleId } = useSheetContext("SheetTitle");

  return (
    <h2
      id={titleId}
      className={joinClasses("text-base font-semibold text-foreground", className)}
      {...props}
    />
  );
}

type SheetDescriptionProps = HTMLAttributes<HTMLParagraphElement>;

export function SheetDescription({ className, ...props }: SheetDescriptionProps) {
  const { descriptionId } = useSheetContext("SheetDescription");

  return (
    <p
      id={descriptionId}
      className={joinClasses("text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}
