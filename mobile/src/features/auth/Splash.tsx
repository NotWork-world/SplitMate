import React, {useEffect} from 'react';
import {StyleSheet, View} from 'react-native';
import Animated, {Easing, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming} from 'react-native-reanimated';
import {Accent, LogoMark, Text, useTheme} from '../../design';

/** Brand splash: the framed mark settles in, then the wordmark rises. */
export function Splash({ready, onDone}: {ready: boolean; onDone: () => void}) {
  const {colors} = useTheme();
  const scale = useSharedValue(0.86);
  const mark = useSharedValue(0);
  const word = useSharedValue(0);
  const fade = useSharedValue(1);

  useEffect(() => {
    scale.value = withSpring(1, {damping: 14, stiffness: 120});
    mark.value = withTiming(1, {duration: 420});
    word.value = withDelay(260, withTiming(1, {duration: 480, easing: Easing.out(Easing.cubic)}));
  }, [scale, mark, word]);

  useEffect(() => {
    if (ready) {
      fade.value = withDelay(650, withTiming(0, {duration: 320}, f => f && runOnJS(onDone)()));
    }
  }, [ready, fade, onDone]);

  const markStyle = useAnimatedStyle(() => ({opacity: mark.value, transform: [{scale: scale.value}]}));
  const wordStyle = useAnimatedStyle(() => ({opacity: word.value, transform: [{translateY: (1 - word.value) * 14}]}));
  const rootStyle = useAnimatedStyle(() => ({opacity: fade.value}));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, {backgroundColor: colors.bg}, rootStyle]} accessibilityLabel="SplitMate is starting">
      <Animated.View style={markStyle}>
        <View style={[styles.tile, {backgroundColor: '#DCE3D1'}]}>
          <LogoMark size={96} framed />
        </View>
      </Animated.View>
      <Animated.View style={[{alignItems: 'center', marginTop: 24, alignSelf: 'stretch'}, wordStyle]}>
        <Text variant="hero" align="center" style={{alignSelf: 'stretch'}}>
          Split<Accent>Mate</Accent>
        </Text>
        <Text variant="body" tone="muted" style={{marginTop: 4}}>
          Split only what you shared.
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {alignItems: 'center', justifyContent: 'center', zIndex: 10},
  tile: {padding: 18, borderRadius: 34},
});
