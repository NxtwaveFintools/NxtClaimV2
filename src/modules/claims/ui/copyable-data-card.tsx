"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";

type CopyableDataCardProps = {
  label: string;
  value: string;
  className?: string;
};

const baseClassName =
  "bg-muted/20 border border-border/40 rounded-xl p-4 flex flex-col justify-center h-full transition-colors hover:bg-muted/30 hover:border-border/60 group relative cursor-pointer text-left";
const labelClassName =
  "text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1";
const valueClassName = "text-sm md:text-base text-foreground font-medium break-words";

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
