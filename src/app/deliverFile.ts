/** Getting a generated file out of an iOS home-screen web app. Downloads are
 *  unreliable in standalone mode, so prefer the share sheet (Save to Files /
 *  Mail → tap the attachment → "Add All" to Calendar), fall back to a
 *  regular download elsewhere. */
export async function deliverFile(name: string, text: string, type: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([text], name, { type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
      // fall through to download
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return 'downloaded';
}

/** Absolute URL of a file served next to the app (for opening in Safari). */
export function appAssetUrl(path: string): string {
  return new URL(path, new URL(import.meta.env.BASE_URL, location.origin)).href;
}
