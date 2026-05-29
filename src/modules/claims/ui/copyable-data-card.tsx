"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";

type CopyableDataCardProps = {
  label: string;
  value: string;
  className?: string;
};

const baseClassName =
  "min-h-[52px] bg-background-secondary border border-border rounded-lg p-2.5 flex flex-col justify-center transition-colors hover:bg-muted/30 group relative cursor-pointer text-left";
const labelClassName =
  "text-[10px] uppercase tracking-[0.06em] text-muted-foreground font-semibold mb-0.5";
const valueClassName = "text-[13px] leading-snug text-foreground font-medium break-words";

export function CopyableDataCard({ label, value, className }: CopyableDataCardProps) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied!");
    } catch {
      toast.error("Unable to copy value.");
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`${baseClassName}${className ? ` ${className}` : ""}`}
      title="Click to copy"
    >
      <Copy className="w-3 h-3 absolute top-3 right-3 opacity-0 group-hover:opacity-50 transition-opacity" />
      <p className={labelClassName}>{label}</p>
      <p className={valueClassName}>{value}</p>
    </button>
  );
}
