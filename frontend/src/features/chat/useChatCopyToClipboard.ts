import * as React from 'react';

import { copyToClipboardSafe } from '../../utils/clipboard';

export type ChatCopyToClipboardOptions = {
  /**
   * When true, do not run `onCopied` (skip global toast).
   * Use for AI Helper — it shows inline “Copied” on the button for iOS/Android/web.
   */
  skipToast?: boolean;
};

export function useChatCopyToClipboard(opts: {
  openInfo: (title: string, body: string) => void;
  /** Called after a successful copy (e.g. in-app toast — iOS has no system “Copied” banner like some Androids). */
  onCopied?: () => void;
}): {
  copyToClipboard: (text: string, opts?: ChatCopyToClipboardOptions) => Promise<boolean>;
} {
  const { openInfo, onCopied } = opts;

  const copyToClipboard = React.useCallback(
    async (text: string, copyOpts?: ChatCopyToClipboardOptions) => {
      return copyToClipboardSafe({
        text,
        onUnavailable: () => {
          openInfo(
            'Copy unavailable',
            'Your current build does not include clipboard support yet. Rebuild the dev client to enable Copy.',
          );
        },
        onCopied: copyOpts?.skipToast ? undefined : onCopied,
      });
    },
    [openInfo, onCopied],
  );

  return { copyToClipboard };
}
