import { toast } from 'sonner';

/**
 * Fallback for insecure contexts (plain HTTP on a LAN address), where navigator.clipboard is unavailable.
 * The helper textarea goes into the open dialog, if any, so its focus trap does not block the selection.
 */
function legacyCopy(text: string): void {
  const container = document.activeElement?.closest('[role="dialog"], [role="alertdialog"]') ?? document.body;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  container.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand('copy');
  textarea.remove();
  if (!ok) throw new Error('Copy command failed');
}

export async function copyText(text: string, what = 'Text'): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
    else legacyCopy(text);
    toast.success(`${what} copied to the clipboard`);
    return true;
  } catch {
    toast.error('Could not copy to the clipboard', { description: 'Select the text and copy it manually.' });
    return false;
  }
}
