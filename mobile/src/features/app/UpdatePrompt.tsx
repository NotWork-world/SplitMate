import React, {useState} from 'react';
import {Linking, Pressable, StyleSheet, View} from 'react-native';
import RNFS from 'react-native-fs';
import {ArrowUpRight, X} from 'lucide-react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useHealthQuery} from '../../api/endpoints';
import {APP_VERSION} from '../../config';
import {installApk} from '../../native/ApkInstaller';
import {isNewerVersion} from '../../version';
import {Text, useTheme} from '../../design';

const RELEASES_URL = 'https://github.com/NotWork-world/SplitMate/releases/latest';

/**
 * "Update SplitMate" card, shown over the app (like the offline banner) when
 * the server reports a newer app version than the one running. One tap
 * downloads the APK (kept in the cache for that version, so a retry or a
 * cancelled install doesn't download it again) and hands it to Android's own
 * installer - the person confirms there, the way every app installs.
 *
 * Errors are said plainly, never guessed: a missing internet connection is a
 * retry note, the one-time "allow installs" screen points back at the card.
 */
export function UpdatePrompt() {
  const {colors} = useTheme();
  const insets = useSafeAreaInsets();
  const health = useHealthQuery();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const latest = health.data?.app?.latest;
  const apkUrl = health.data?.app?.apk_url;
  const show = !!latest && !!apkUrl && isNewerVersion(APP_VERSION, latest) && !dismissed;

  if (!show) {
    return null;
  }

  const update = async () => {
    if (!latest || !apkUrl || busy) {
      return;
    }
    setNote(null);
    setBusy(true);
    // The APK is cached per version: a second tap (or a cancelled install)
    // goes straight to the installer instead of downloading all over again.
    const dest = `${RNFS.CachesDirectoryPath}/SplitMate-${latest}.apk`;
    try {
      if (!(await RNFS.exists(dest))) {
        setPct(0);
        const res = await RNFS.downloadFile({
          fromUrl: apkUrl,
          toFile: dest,
          progressInterval: 300,
          progress: r => {
            if (r.contentLength > 0) {
              setPct(Math.min(99, Math.round((r.bytesWritten / r.contentLength) * 100)));
            }
          },
        }).promise;
        if (!res.statusCode || res.statusCode >= 400) {
          throw new Error(`download failed (${res.statusCode ?? 'no status'})`);
        }
      }
      setPct(100);
      await installApk(dest);
      // The installer is up; the person confirms the update on that screen.
      setNote('Confirm the install on the screen that just opened.');
    } catch (e) {
      const err = e as {code?: string; message?: string};
      if (err.code === 'permission_needed') {
        // Android's one-time "allow installs from this app" screen is open.
        setNote('Allow installs for SplitMate there, come back and tap Update again.');
      } else if (err.message?.includes('store')) {
        // A platform whose updates come from a store, not an APK.
        setNote('Opening the download page instead.');
        try {
          await Linking.openURL(RELEASES_URL);
        } catch {}
      } else {
        setNote("The update didn't download. Check your internet connection and try again.");
      }
    } finally {
      setPct(null);
      setBusy(false);
    }
  };

  const label = !busy ? 'Update' : pct === null ? 'Preparing…' : pct < 100 ? `Downloading ${pct}%` : 'Opening the installer…';

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.wrap, {backgroundColor: colors.bgElevated, borderColor: colors.border, top: insets.top + 6}]}>
      <View style={styles.row}>
        <Text variant="bodyStrong" style={{flex: 1}}>
          Update SplitMate
        </Text>
        <Pressable accessibilityLabel="Dismiss" hitSlop={10} onPress={() => setDismissed(true)}>
          <X size={18} color={colors.textFaint} />
        </Pressable>
      </View>
      <Text variant="small" tone="muted">
        Version {latest} is ready — one tap downloads it, and Android asks you to confirm the install.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Update now"
        onPress={update}
        disabled={busy}
        style={({pressed}) => [styles.update, {backgroundColor: pressed ? colors.surfacePressed : colors.highlight, opacity: busy ? 0.7 : 1}]}>
        <ArrowUpRight size={15} color={colors.highlightText} />
        <Text variant="smallStrong" color={colors.highlightText}>
          {label}
        </Text>
      </Pressable>
      {note ? (
        <Text variant="caption" tone="warning">
          {note}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 4,
    elevation: 6,
    shadowColor: '#1F3B2D',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: {width: 0, height: 4},
    zIndex: 101,
  },
  row: {flexDirection: 'row', alignItems: 'center', gap: 10},
  update: {flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, marginTop: 2},
});
