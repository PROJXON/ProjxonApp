import React from 'react';
import { Image, StyleSheet, Text, View, ViewStyle } from 'react-native';

export const AVATAR_DEFAULT_COLORS = [
  '#5865F2', // blurple-ish
  '#57F287', // green
  '#FEE75C', // yellow
  '#EB459E', // pink
  '#ED4245', // red
  '#3498DB', // blue
  '#9B59B6', // purple
  '#E67E22', // orange
  '#1ABC9C', // teal
  '#95A5A6', // gray
];

function hashStringToInt(input: string): number {
  // Small, deterministic hash (djb2-ish)
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return h >>> 0;
}

export function pickDefaultAvatarColor(seed: string): string {
  const s = String(seed || '').trim();
  const idx = s ? hashStringToInt(s) % AVATAR_DEFAULT_COLORS.length : 0;
  return AVATAR_DEFAULT_COLORS[idx] || AVATAR_DEFAULT_COLORS[0];
}

function firstLetter(label: string): string {
  const s = String(label || '').trim();
  if (!s) return '?';
  return s.slice(0, 1).toUpperCase();
}

export function AvatarBubble({
  seed,
  label,
  size = 34,
  backgroundColor,
  textColor = '#fff',
  imageUri,
  style,
}: {
  seed: string;
  label: string;
  size?: number;
  backgroundColor?: string;
  textColor?: string;
  imageUri?: string;
  style?: ViewStyle;
}): React.JSX.Element {
  const bg = backgroundColor || pickDefaultAvatarColor(seed);
  const letter = firstLetter(label);
  const [imageFailed, setImageFailed] = React.useState<boolean>(false);
  const fontSize = Math.max(14, Math.floor(size * 0.58));
  const lineHeight = Math.max(16, Math.floor(fontSize * 1.02));

  // If the URI changes, allow a new load attempt.
  React.useEffect(() => {
    setImageFailed(false);
  }, [imageUri]);

  return (
    <View
      style={[
        styles.root,
        {
          width: size,
          height: size,
          borderRadius: Math.floor(size / 2),
          backgroundColor: bg,
        },
        style,
      ]}
    >
      {imageUri && !imageFailed ? (
        <Image
          source={{ uri: imageUri }}
          onError={() => setImageFailed(true)}
          style={[styles.image, { borderRadius: Math.floor(size / 2) }]}
        />
      ) : (
        <Text style={[styles.text, { color: textColor, fontSize, lineHeight }]}>{letter}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  text: {
    fontWeight: '900',
    fontSize: 14,
    lineHeight: 16,
  },
});


