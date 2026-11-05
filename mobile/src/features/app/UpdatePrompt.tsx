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
 * the server reports a newer app version than the one running. Update: the
 * APK downloads with a progress readout, then Android's own installer opens.
 * If the direct download isn't possible (offline, private release), the
 * releases page opens in the browser instead.
 */
export function UpdatePrompt() {
  const {colors} = useTheme();
  const insets = useSafeAreaInsets();
  const health = useHealthQuery();
  const [dismissed, setDismissed] = useState(false);
  const [pct, setPct] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const latest = health.data?.app?.latest;
  const apkUrl = health.data?.app?.apk_url;
  const show = !!latest && !!apkUrl && isNewerVersion(APP_VERSION, latest) && !dismissed;

  if (!show) {
    return null;
  }

  const download = async () => {
    if (!apkUrl || pct !== null) {
      return;
    }
    setNote(null);
    setPct(0);
    try {
      const dest = `${RNFS.CachesDirectoryPath}/SplitMate-update.apk`;
      const job = RNFS.downloadFile({
        fromUrl: apkUrl,
        toFile: dest,
        progressInterval: 300,
        progress: r => {
          if (r.contentLength > 0) {
            setPct(Math.min(99, Math.round((r.bytesWritten / r.contentLength) * 100)));
          }
        },
      });
      const res = await job.promise;
      if (!res.statusCode || res.statusCode >= 400) {
        throw new Error(`download failed (${res.statusCode ?? 'no status'})`);
      }
      setPct(100);
      await installApk(dest);
      setPct(null); // the installer screen is up; stay quiet behind it
    } catch {
      // Couldn't fetch/install here (offline, release not public): the release
      // page in the browser downloads the same APK with one more tap.
      setPct(null);
      setNote('Opening the download page instead — install from there.');
      try {
        await Linking.openURL(RELEASES_URL);
      } catch {}
    }
  };

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
        Version {latest} is out{pct === null ? ' — the update downloads and installs by itself.' : ''}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Update now"
        onPress={download}
        disabled={pct !== null}
        style={({pressed}) => [styles.update, {backgroundColor: pressed ? colors.surfacePressed : colors.highlight, opacity: pct === 100 ? 0.6 : 1}]}>
        <ArrowUpRight size={15} color={colors.highlightText} />
        <Text variant="smallStrong" color={colors.highlightText}>
          {pct === null ? 'Update' : pct < 100 ? `Downloading ${pct}%` : 'Opening installer…'}
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
