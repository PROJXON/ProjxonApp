export async function copyToClipboardSafe(opts: {
  text: string;
  onUnavailable: () => void;
  onCopied?: () => void;
}): Promise<boolean> {
  const { text, onUnavailable, onCopied } = opts;
  try {
    const Clipboard = await import('expo-clipboard');
    await Clipboard.setStringAsync(text);
    onCopied?.();
    return true;
  } catch {
    onUnavailable();
    return false;
  }
}
