import { removeBackground } from "@imgly/background-removal";

export async function removeBackgroundClient(
  imageDataUrl: string,
): Promise<{ ok: true; imageDataUrl: string } | { ok: false; error: string }> {
  try {
    const blob = await removeBackground(imageDataUrl);
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(new Error("read failed"));
      r.readAsDataURL(blob);
    });
    return { ok: true, imageDataUrl: dataUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
