import React, {useEffect} from 'react';
import {StyleSheet, View} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {Glow, LogoMark, Text, useTheme} from '../../design';

/** Brand splash: the two plate halves slide together, then the wordmark rises. */
export function Splash({ready, onDone}: {ready: boolean; onDone: () => void}) {
  const {colors} = useTheme();
  const left = useSharedValue(-40);
  const right = useSharedValue(40);
  const word = useSharedValue(0);
  const fade = useSharedValue(1);

  useEffect(() => {
    left.value = withSpring(0, {damping: 12, stiffness: 120});
    right.value = withSpring(0, {damping: 12, stiffness: 120});
    word.value = withDelay(250, withTiming(1, {duration: 500, easing: Easing.out(Easing.cubic)}));
  }, [left, right, word]);

  useEffect(() => {
    if (ready) {
      fade.value = withDelay(650, withSequence(withTiming(0, {duration: 320}, f => f && runOnJS(onDone)())));
    }
  }, [ready, fade, onDone]);

  const leftStyle = useAnimatedStyle(() => ({transform: [{translateX: left.value}]}));
  const rightStyle = useAnimatedStyle(() => ({transform: [{translateX: right.value}]}));
  const wordStyle = useAnimatedStyle(() => ({opacity: word.value, transform: [{translateY: (1 - word.value) * 14}]}));
  const rootStyle = useAnimatedStyle(() => ({opacity: fade.value}));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, {backgroundColor: colors.bg}, rootStyle]} accessibilityLabel="SplitMate is starting">
      <Glow color={colors.accent} size={460} style={{top: '18%', alignSelf: 'center'}} />
      <View style={styles.markRow}>
        <Animated.View style={leftStyle}>
          <View style={{width: 44, overflow: 'hidden'}}>
            <LogoMark size={88} />
          </View>
        </Animated.View>
        <Animated.View style={rightStyle}>
          <View style={{width: 44, overflow: 'hidden', alignItems: 'flex-end'}}>
            <View style={{marginLeft: -44}}>
              <LogoMark size={88} />
            </View>
          </View>
        </Animated.View>
      </View>
      <Animated.View style={[{alignItems: 'center', marginTop: 20}, wordStyle]}>
        <Text variant="hero">
          Split<Text variant="hero" tone="food">Mate</Text>
        </Text>
        <Text variant="body" tone="muted" style={{marginTop: 6}}>
          Split only what you shared.
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {alignItems: 'center', justifyContent: 'center', zIndex: 10},
  markRow: {flexDirection: 'row'},
});
