function getExtensionFromUrl(url: string): string {
  try {
    const parsed = new URL(url, window.location.origin);
    const fileName = parsed.pathname.split("/").pop() ?? "";
    const lastDotIndex = fileName.lastIndexOf(".");

    if (lastDotIndex <= 0 || lastDotIndex === fileName.length - 1) {
      return "";
    }

    return fileName.slice(lastDotIndex).toLowerCase();
  } catch {
    return "";
  }
}

function getExtensionFromMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();

  if (normalized === "application/pdf") {
    return ".pdf";
  }

  if (normalized === "image/jpeg") {
    return ".jpg";
  }

  if (normalized === "image/png") {
    return ".png";
  }

  if (normalized === "image/webp") {
    return ".webp";
  }

  if (normalized === "image/gif") {
    return ".gif";
  }

  return "";
}

export async function downloadFileWithSemanticName(url: string, fileName: string): Promise<void> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download file. Status: ${response.status}`);
  }

  const fileBlob = await response.blob();
  const extension = getExtensionFromUrl(url) || getExtensionFromMimeType(fileBlob.type);
  const objectUrl = window.URL.createObjectURL(fileBlob);

  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = `${fileName}${extension}`;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.URL.revokeObjectURL(objectUrl);
}
