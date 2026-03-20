import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Platform, ToastAndroid } from 'react-native';
import { NativeModules } from 'react-native';

export type SaveMediaKind = 'image' | 'video' | 'file';

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || 'Unknown error';
  if (typeof err === 'string') return err || 'Unknown error';
  if (!err) return 'Unknown error';
  try {
    const rec = err as Record<string, unknown>;
    const msg = rec?.message;
    return typeof msg === 'string' && msg ? msg : 'Unknown error';
  } catch {
    return 'Unknown error';
  }
}

type ExpoFileSystemLike = {
  Paths?: { cache?: unknown; document?: unknown };
  cacheDirectory?: string;
  documentDirectory?: string;
  getInfoAsync?: (uri: string) => Promise<{ exists?: boolean }>;
  deleteAsync?: (uri: string, opts?: { idempotent?: boolean }) => Promise<void>;
  makeDirectoryAsync?: (uri: string, opts?: { intermediates?: boolean }) => Promise<void>;
  downloadAsync?: (
    remoteUrl: string,
    fileUri: string,
    opts?: Record<string, unknown>,
  ) => Promise<{ uri?: string }>;
  readAsStringAsync?: (uri: string, opts?: { encoding?: unknown }) => Promise<string>;
  writeAsStringAsync?: (uri: string, data: string, opts?: { encoding?: unknown }) => Promise<void>;
  EncodingType?: { Base64?: unknown };
  StorageAccessFramework?: {
    requestDirectoryPermissionsAsync?: () => Promise<{ granted?: boolean; directoryUri?: string }>;
    createFileAsync?: (directoryUri: string, fileName: string, mimeType: string) => Promise<string>;
  };
  File?: {
    new (
      root: string,
      name: string,
    ): {
      uri: string;
      write?: (data: string, opts: { encoding: 'base64' }) => Promise<void>;
      downloadFileAsync?: (url: string) => Promise<void>;
    };
    downloadFileAsync?: (url: string, dest: { uri: string }) => Promise<void>;
  };
};

function isUserCancelledError(msg: string): boolean {
  const s = String(msg || '').toLowerCase();
  // expo-sharing on iOS can throw "User canceled" / "cancelled".
  return s.includes('cancel') || s.includes('canceled') || s.includes('cancelled');
}

async function ensureEmptyDest(fs: ExpoFileSystemLike, uri: string): Promise<void> {
  try {
    if (typeof fs.deleteAsync !== 'function') return;
    // Avoid deprecated getInfoAsync; idempotent delete is sufficient for our temp paths.
    await fs.deleteAsync(uri, { idempotent: true });
  } catch {
    // ignore
  }
}

function mimeTypeFromExt(ext: string): string {
  const e = String(ext || '').toLowerCase();
  if (e === 'pdf') return 'application/pdf';
  if (e === 'mp3') return 'audio/mpeg';
  if (e === 'm4a') return 'audio/mp4';
  if (e === 'aac') return 'audio/aac';
  if (e === 'wav') return 'audio/wav';
  if (e === 'png') return 'image/png';
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
  if (e === 'mp4') return 'video/mp4';
  return 'application/octet-stream';
}

function parseDataUriBase64(url: string): string | null {
  if (!url.startsWith('data:')) return null;
  const comma = url.indexOf(',');
  if (comma < 0) return null;
  const header = url.slice(0, comma);
  const b64 = url.slice(comma + 1);
  const isBase64 = /;base64/i.test(header);
  return isBase64 ? b64 : null;
}

function toFileUri(uri: string): string {
  const u = String(uri || '').trim();
  if (!u) return u;
  if (u.startsWith('file://')) return u;
  if (u.startsWith('/')) return `file://${u}`;
  return u;
}

function dirLikeToString(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (isRecord(v)) {
    const uri = v.uri;
    if (typeof uri === 'string') return uri.trim();
    const path = (v as Record<string, unknown>).path;
    if (typeof path === 'string') return path.trim();
  }
  return '';
}

function pickWritableRoot(...candidates: unknown[]): string {
  for (const c of candidates) {
    const s = dirLikeToString(c);
    if (s) return s;
  }
  return '';
}

function tryRequireLegacyFileSystem(): ExpoFileSystemLike {
  try {
    const legacyMod: unknown = require('expo-file-system/legacy');
    return isRecord(legacyMod) ? (legacyMod as ExpoFileSystemLike) : {};
  } catch {
    return {};
  }
}

const ANDROID_SAF_DIR_KEY = 'downloads:safDirectoryUri:v1';

async function shareLocalFile({
  localUri,
  mimeType,
}: {
  localUri: string;
  mimeType: string;
}): Promise<void> {
  const Sharing = require('expo-sharing') as Record<string, unknown>;
  const isAvailableAsync = (Sharing as any).isAvailableAsync as
    | undefined
    | (() => Promise<boolean>);
  const shareAsync = (Sharing as any).shareAsync as
    | undefined
    | ((
        uri: string,
        opts?: { mimeType?: string; dialogTitle?: string; UTI?: string },
      ) => Promise<void>);
  if (typeof shareAsync !== 'function') throw new Error('Sharing API not available');
  if (typeof isAvailableAsync === 'function') {
    const ok = await isAvailableAsync().catch(() => false);
    if (!ok) throw new Error('Sharing is not available on this device');
  }
  await shareAsync(localUri, { dialogTitle: 'Save attachment', mimeType, UTI: undefined });
}

export async function saveMediaUrlToDevice({
  url,
  kind,
  fileName,
  onPermissionDenied: _onPermissionDenied,
  onSuccess,
  onError,
}: {
  url: string;
  kind: SaveMediaKind;
  fileName?: string;
  onPermissionDenied?: () => void;
  onSuccess?: () => void;
  onError?: (message: string) => void;
}): Promise<void> {
  const safeNameWithExt = (fileName || `attachment-${Date.now()}`)
    .replace(/[^\w.\-() ]+/g, '_')
    .slice(0, 120);
  const extFromName = (() => {
    const m = safeNameWithExt.match(/\.([a-zA-Z0-9]{1,8})$/);
    return m ? m[1].toLowerCase() : '';
  })();
  const ext = extFromName || (kind === 'image' ? 'jpg' : kind === 'video' ? 'mp4' : 'bin');
  const baseName = safeNameWithExt.replace(/\.[^.]+$/, '') || `attachment-${Date.now()}`;
  const downloadName = `${baseName}.${ext}`;
  const tmpId = `${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;
  const uniqueLeaf = `${tmpId}-${downloadName}`;

  try {
    // Web: use a browser download flow (MediaLibrary/FileSystem aren't applicable).
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const clickDownload = (href: string) => {
        const a = document.createElement('a');
        a.href = href;
        a.download = downloadName;
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
      };

      // Data/blob URLs can be downloaded directly.
      if (url.startsWith('data:') || url.startsWith('blob:')) {
        clickDownload(url);
        onSuccess?.();
        return;
      }

      // Prefer fetching the bytes so the download gets a filename.
      // If CORS blocks fetch, fall back to a direct navigation.
      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Download failed (${resp.status})`);
        const blob = await resp.blob();
        const objUrl = URL.createObjectURL(blob);
        clickDownload(objUrl);
        // Revoke shortly after the click has started.
        setTimeout(() => URL.revokeObjectURL(objUrl), 10_000);
        onSuccess?.();
        return;
      } catch {
        // Last resort: open the URL (may still allow the user to save via browser UI).
        try {
          clickDownload(url);
          onSuccess?.();
          return;
        } catch {
          // ignore
        }
      }

      throw new Error('Unable to download on web (blocked by browser/CORS)');
    }

    // ANDROID: download-like saves should land in Downloads (and use name collision handling).
    // This applies to files + audio + images + videos when user taps the "Download/Save" action.
    if (Platform.OS === 'android' && (kind === 'file' || kind === 'image' || kind === 'video')) {
      try {
        const mod = (NativeModules as any)?.AndroidDownloads;
        const fn = mod?.downloadToDownloads as
          | undefined
          | ((u: string, name: string, mt: string) => Promise<string>);
        if (typeof fn === 'function') {
          const mimeType = mimeTypeFromExt(extFromName || ext);
          await fn(url, downloadName, mimeType);
          if (onSuccess) onSuccess();
          else ToastAndroid.show('Saved to Downloads', ToastAndroid.SHORT);
          return;
        }
      } catch {
        // fall through to JS-based attempts below
      }
    }

    // Native "download/save" flow:
    // - Android: files/images/videos go through Downloads/share fallbacks.
    // - iOS: use the system share/save sheet for all kinds to maximize reliability in dev-client builds.
    if (
      kind === 'file' ||
      Platform.OS === 'ios' ||
      (Platform.OS === 'android' && (kind === 'image' || kind === 'video'))
    ) {
      const fsMod: unknown = require('expo-file-system');
      const fs: ExpoFileSystemLike = isRecord(fsMod) ? (fsMod as ExpoFileSystemLike) : {};
      const mimeType = mimeTypeFromExt(extFromName || ext);

      // Android: fallback path when the native module isn't present (e.g. old dev-client build).
      if (Platform.OS === 'android') {
        // SAF lives on expo-file-system legacy in many builds.
        const legacy: any = tryRequireLegacyFileSystem();
        const SAF = legacy.StorageAccessFramework;
        const encBase64 = legacy.EncodingType?.Base64;
        const readAsStringAsync = legacy.readAsStringAsync as
          | undefined
          | ((uri: string, opts?: { encoding?: unknown }) => Promise<string>);
        const writeAsStringAsync = legacy.writeAsStringAsync as
          | undefined
          | ((uri: string, data: string, opts?: { encoding?: unknown }) => Promise<void>);
        const downloadAsync = legacy.downloadAsync as
          | undefined
          | ((remoteUrl: string, fileUri: string) => Promise<{ uri?: string }>);
        const getInfoAsync = legacy.getInfoAsync as
          | undefined
          | ((uri: string) => Promise<{ exists?: boolean }>);
        const deleteAsync = legacy.deleteAsync as
          | undefined
          | ((uri: string, opts?: { idempotent?: boolean }) => Promise<void>);

        const ensureEmpty = async (uri: string) => {
          try {
            if (typeof getInfoAsync !== 'function' || typeof deleteAsync !== 'function') return;
            const info = await getInfoAsync(uri);
            if (info?.exists) await deleteAsync(uri, { idempotent: true });
          } catch {
            // ignore
          }
        };

        // If SAF isn't available, fall back to the share sheet (still lets users save via Files/Drive/etc).
        if (
          !SAF ||
          typeof SAF.requestDirectoryPermissionsAsync !== 'function' ||
          typeof SAF.createFileAsync !== 'function' ||
          typeof writeAsStringAsync !== 'function' ||
          typeof readAsStringAsync !== 'function' ||
          !encBase64
        ) {
          const Sharing = require('expo-sharing') as Record<string, unknown>;
          const shareAsync = (Sharing as any).shareAsync as
            | undefined
            | ((uri: string, opts?: Record<string, unknown>) => Promise<void>);
          if (typeof shareAsync === 'function') {
            // Best-effort: download into a unique local path with a clean leaf name.
            try {
              const baseDir = legacy.cacheDirectory || legacy.documentDirectory;
              if (typeof baseDir === 'string' && baseDir) {
                const tmpUri = `${baseDir.replace(/\/+$/, '')}/${uniqueLeaf}`;
                await ensureEmpty(tmpUri);
                if (
                  typeof downloadAsync === 'function' &&
                  !url.startsWith('data:') &&
                  !url.startsWith('file:')
                )
                  await downloadAsync(url, tmpUri);
                await shareAsync(tmpUri, {
                  dialogTitle: 'Save attachment',
                  mimeType,
                  UTI: undefined,
                });
                if (onSuccess) onSuccess();
                else ToastAndroid.show('Ready to save', ToastAndroid.SHORT);
                return;
              }
            } catch {
              // ignore and fall through
            }
          }
          throw new Error('Android save prompt is not available in this build');
        }

        // Download into app cache first so we always have a real file:// uri with the *real filename*.
        const baseDir = legacy.cacheDirectory || legacy.documentDirectory;
        if (!(typeof baseDir === 'string') || !baseDir)
          throw new Error('No writable cache directory');
        const dirUri = `${baseDir.replace(/\/+$/, '')}/dl-${tmpId}`;
        try {
          const mk = legacy.makeDirectoryAsync as
            | undefined
            | ((uri: string, opts?: { intermediates?: boolean }) => Promise<void>);
          if (typeof mk === 'function') await mk(dirUri, { intermediates: true });
        } catch {
          // ignore
        }
        const localUri = `${dirUri}/${downloadName}`;
        await ensureEmpty(localUri);
        const directB64 = parseDataUriBase64(url);
        if (directB64) {
          await writeAsStringAsync(localUri, directB64, { encoding: encBase64 });
        } else if (url.startsWith('file:')) {
          // Already local; just share it (no need to re-copy).
        } else {
          if (typeof downloadAsync !== 'function')
            throw new Error('File download API not available');
          await downloadAsync(url, localUri);
        }

        // Try SAF (folder save) if we can get permissions; many devices/emulators disallow Downloads/root.
        try {
          let directoryUri: string | null = null;
          try {
            directoryUri = (await AsyncStorage.getItem(ANDROID_SAF_DIR_KEY)) || null;
          } catch {
            directoryUri = null;
          }

          if (!directoryUri) {
            const perm = await SAF.requestDirectoryPermissionsAsync();
            if (!perm?.granted || !perm.directoryUri) {
              // User cancelled OR system blocked "Use this folder" — fall back to share sheet.
              await shareLocalFile({
                localUri: url.startsWith('file:') ? url : localUri,
                mimeType,
              });
              onSuccess?.();
              return;
            }
            directoryUri = String(perm.directoryUri || '').trim() || null;
            if (directoryUri) {
              try {
                await AsyncStorage.setItem(ANDROID_SAF_DIR_KEY, directoryUri);
              } catch {
                // ignore
              }
            }
          }

          if (directoryUri) {
            const b64 = url.startsWith('file:')
              ? await readAsStringAsync(url, { encoding: encBase64 })
              : await readAsStringAsync(localUri, { encoding: encBase64 });
            const outUri = await SAF.createFileAsync(directoryUri, downloadName, mimeType);
            await writeAsStringAsync(outUri, b64, { encoding: encBase64 });
            onSuccess?.();
            return;
          }
        } catch {
          // ignore SAF failures and fall back to share sheet below
        }

        // Reliable fallback: system share/save sheet (lets user "Save to Drive", etc).
        await shareLocalFile({ localUri: url.startsWith('file:') ? url : localUri, mimeType });
        if (onSuccess) onSuccess();
        return;
      }

      // iOS: use system share sheet. Build a local file first for remote/data URLs.
      if (url.startsWith('file:')) {
        await shareLocalFile({ localUri: toFileUri(url), mimeType });
        if (onSuccess) onSuccess();
        return;
      }

      const legacy: ExpoFileSystemLike = tryRequireLegacyFileSystem();
      const root = pickWritableRoot(
        fs.Paths?.cache,
        fs.Paths?.document,
        fs.cacheDirectory,
        fs.documentDirectory,
        legacy.cacheDirectory,
        legacy.documentDirectory,
      );
      if (!root) throw new Error('No writable cache directory');
      const rootBase = root.replace(/\/+$/, '');
      // iOS/dev-client: write directly to known cache root to avoid mkdir path issues.
      const localDestUri = `${rootBase}/${tmpId}-${downloadName}`;
      await ensureEmptyDest(fs, localDestUri);
      await ensureEmptyDest(legacy, localDestUri);

      let localUri = '';
      if (url.startsWith('data:')) {
        const b64 = parseDataUriBase64(url);
        if (!b64) throw new Error('Unsupported data URI encoding');
        if (typeof fs.writeAsStringAsync === 'function' && fs.EncodingType?.Base64) {
          await fs.writeAsStringAsync(localDestUri, b64, { encoding: fs.EncodingType.Base64 });
          localUri = toFileUri(localDestUri);
        } else if (typeof legacy.writeAsStringAsync === 'function' && legacy.EncodingType?.Base64) {
          await legacy.writeAsStringAsync(localDestUri, b64, {
            encoding: legacy.EncodingType.Base64,
          });
          localUri = toFileUri(localDestUri);
        } else {
          throw new Error('File write API not available');
        }
      } else {
        const File = fs.File;
        // iOS/dev-client: use legacy downloadAsync to avoid deprecation-guard exceptions.
        if (typeof legacy.downloadAsync === 'function') {
          const out = await legacy.downloadAsync(url, localDestUri);
          localUri = toFileUri(String(out?.uri || localDestUri));
        }
        if (!localUri && File) {
          const dest = new File(rootBase, `${tmpId}-${downloadName}`);
          await ensureEmptyDest(fs, dest.uri);
          if (typeof dest.downloadFileAsync === 'function') {
            await dest.downloadFileAsync(url);
            localUri = toFileUri(dest.uri);
          } else if (typeof File.downloadFileAsync === 'function') {
            await File.downloadFileAsync(url, dest);
            localUri = toFileUri(dest.uri);
          }
        }
        if (!localUri) throw new Error('File download API not available');
      }

      await shareLocalFile({ localUri, mimeType });
      if (onSuccess) onSuccess();
      return;
    }
    throw new Error(`Unsupported save path for platform ${Platform.OS}`);
  } catch (e: unknown) {
    const msg = getErrorMessage(e) || 'Could not save attachment';
    // Avoid noisy errors when a user closes the system share sheet.
    if (kind === 'file' && isUserCancelledError(msg)) return;
    if (onError) onError(msg);
    else Alert.alert('Download failed', msg);
  }
}
