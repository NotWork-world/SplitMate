import React, {useRef, useState} from 'react';
import {FlatList, StyleSheet, useWindowDimensions, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Accent, Button, LogoMark, Text, pastels, radius, space, useTheme} from '../../design';
import type {AuthScreen} from '../../navigation/types';

const SLIDES = [
  {lead: 'Split', accent: 'only', tail: 'what you shared', body: 'Every dish is a card. Say who had it and SplitMate does the maths. Nothing is ever assigned for you.', cards: ['🍛', '🍕', '🍵']},
  {lead: 'GST and discounts,', accent: 'exactly', tail: '', body: 'CGST + SGST, coupons, service charge, tips and rounding, worked out to the paisa and shown line by line.', cards: ['🧾', '％', '₹']},
  {lead: 'Know', accent: 'who owes', tail: 'whom', body: 'Rent, trips and dinners in one place. A payment counts only when the person who received it confirms.', cards: ['🏠', '🧳', '🤝']},
];

export function OnboardingScreen({navigation}: AuthScreen<'Onboarding'>) {
  const {width} = useWindowDimensions();
  const {colors} = useTheme();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const list = useRef<FlatList<(typeof SLIDES)[number]>>(null);

  return (
    <View style={[styles.root, {backgroundColor: colors.bg, paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.lg}]}>
      <View style={{alignItems: 'center'}}>
        <View style={[styles.logoPill, {borderColor: colors.text}]}>
          <LogoMark size={22} />
          <Text variant="smallStrong">SplitMate</Text>
        </View>
      </View>
      <FlatList
        ref={list}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={s => s.lead}
        onMomentumScrollEnd={e => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({item}) => (
          <View style={{width, paddingHorizontal: space.xl, alignItems: 'center'}}>
            <Text variant="hero" align="center" style={{alignSelf: 'stretch', marginTop: space.xxl}}>
              {item.lead} <Accent>{item.accent}</Accent>
              {item.tail ? ` ${item.tail}` : ''}
            </Text>
            <Text variant="body" tone="muted" align="center" style={{marginTop: space.md, maxWidth: 320}}>
              {item.body}
            </Text>
            <View style={[styles.circle, {backgroundColor: colors.highlight}]}>
              {item.cards.map((e: string, i: number) => (
                <View
                  key={e}
                  style={[
                    styles.card,
                    {
                      backgroundColor: i === 1 ? '#FFFFFF' : pastels[(i + 1) % pastels.length],
                      transform: [{rotate: `${(i - 1) * 10}deg`}, {translateY: i === 1 ? -18 : 6}],
                      zIndex: i === 1 ? 2 : 1,
                    },
                  ]}>
                  <Text style={{fontSize: 40, lineHeight: 50}}>{e}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      />
      <View style={styles.dots} accessibilityLabel={`Page ${index + 1} of ${SLIDES.length}`}>
        {SLIDES.map((s, i) => (
          <View key={s.lead} style={[styles.dot, {backgroundColor: i === index ? colors.accent : colors.borderStrong, width: i === index ? 22 : 8}]} />
        ))}
      </View>
      <View style={{paddingHorizontal: space.xl, gap: space.sm}}>
        <Button label="I'm new here" variant="food" size="lg" onPress={() => navigation.navigate('SignUp')} testID="onboarding-signup" />
        <Button label="I have an account" size="lg" onPress={() => navigation.navigate('SignIn')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  logoPill: {flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.2, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6},
  circle: {width: 260, height: 260, borderRadius: 130, marginTop: space.xxl, flexDirection: 'row', alignItems: 'center', justifyContent: 'center'},
  card: {width: 92, height: 120, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', marginHorizontal: -8, shadowColor: '#1F3B2D', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: {width: 0, height: 6}, elevation: 4},
  dots: {flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: space.lg},
  dot: {height: 8, borderRadius: 4},
});
