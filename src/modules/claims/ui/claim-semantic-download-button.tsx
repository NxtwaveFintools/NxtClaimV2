"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { downloadFileWithSemanticName } from "@/lib/files/download-file-with-semantic-name";

type ClaimSemanticDownloadButtonProps = {
  url: string;
  semanticName: string;
  label: string;
  compact?: boolean;
  className?: string;
};

export function ClaimSemanticDownloadButton({
  url,
  semanticName,
  label,
  compact = false,
  className,
}: ClaimSemanticDownloadButtonProps) {
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    if (isDownloading) {
      return;
    }

    setIsDownloading(true);

    try {
      await downloadFileWithSemanticName(url, semanticName);
    } catch (error) {
      console.error("claims.semantic_download.failed", {
        semanticName,
        label,
        error,
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const baseClassName =
    "inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-zinc-800";

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => {
          void handleDownload();
        }}
        disabled={isDownloading}
        title={`Download as ${semanticName}`}
        aria-label={`${label} download`}
        className={
          className ??
          "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-zinc-800"
        }
      >
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        void handleDownload();
      }}
      disabled={isDownloading}
      title={`Download as ${semanticName}`}
      className={className ?? baseClassName}
    >
      <Download className="h-3.5 w-3.5" aria-hidden="true" />
      {isDownloading ? "Downloading..." : label}
    </button>
  );
}
