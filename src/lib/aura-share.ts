export const AURA_APP_URL = "https://aura-style-alchemy.app";
export const AURA_SHARE_CAPTION = `Created with Aura — download the app: ${AURA_APP_URL}`;

/** Try native share sheet (mobile). Returns true if it launched. */
export async function nativeShareFile(file: File, text: string): Promise<boolean> {
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };
  try {
    if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
      await nav.share({ files: [file], text, title: "My Aura outfit" });
      return true;
    }
  } catch {
    /* user cancelled or unsupported — fall through */
  }
  return false;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, b64] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(header)?.[1] ?? "image/png";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Build provider-specific share URLs. Instagram / TikTok cannot receive
 *  a pre-loaded image via web — we open the app and rely on the image
 *  already being in the camera roll (downloaded first). */
export function shareLinks(shareUrl: string, caption: string): Record<string, string> {
  const u = encodeURIComponent(shareUrl);
  const t = encodeURIComponent(caption);
  return {
    whatsapp: `https://wa.me/?text=${t}%20${u}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${u}&quote=${t}`,
    email: `mailto:?subject=${encodeURIComponent("My Aura outfit")}&body=${t}%0A%0A${u}`,
    instagram: "instagram://library",
    tiktok: "snssdk1233://",
  };
}
