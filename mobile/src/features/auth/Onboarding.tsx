import React, {useRef, useState} from 'react';
import {FlatList, StyleSheet, useWindowDimensions, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Button, Card, Glow, Text, useTheme, Wordmark, space, radius} from '../../design';
import type {AuthScreen} from '../../navigation/types';

const SLIDES = [
  {
    emoji: ['🍛', '🍕', '🍵'],
    title: 'Swipe to claim\nwhat you ate',
    body: 'Each dish is a card. Swipe right to say who had it, left to come back later. Nothing is assigned for you.',
  },
  {
    emoji: ['🧾', '％', '₹'],
    title: 'GST, discounts and\nservice charges, exact',
    body: 'Every paisa is accounted for and explained: taxable base, CGST + SGST, coupons, tips and rounding.',
  },
  {
    emoji: ['🏠', '🧳', '🤝'],
    title: 'Rent, trips and\nrepayments too',
    body: "See who owes whom and why. A payment counts only when the person who received it confirms it.",
  },
];

export function OnboardingScreen({navigation}: AuthScreen<'Onboarding'>) {
  const {width} = useWindowDimensions();
  const {colors} = useTheme();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const list = useRef<FlatList<(typeof SLIDES)[number]>>(null);
  const last = index === SLIDES.length - 1;

  return (
    <View style={[styles.root, {backgroundColor: colors.bg, paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg}]}>
      <Glow color={colors.accent} size={480} style={{top: -120, right: -200}} />
      <Glow color={colors.food} size={360} style={{bottom: 80, left: -200}} />
      <View style={{paddingHorizontal: space.xl}}>
        <Wordmark size={24} />
      </View>
      <FlatList
        ref={list}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={s => s.title}
        onMomentumScrollEnd={e => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({item}) => (
          <View style={{width, paddingHorizontal: space.xl, justifyContent: 'center'}}>
            <View style={styles.emojiRow}>
              {item.emoji.map((e: string, i: number) => (
                <Card key={e} strong style={[styles.emojiCard, {transform: [{rotate: `${(i - 1) * 8}deg`}, {translateY: i === 1 ? -14 : 0}]}]}>
                  <Text style={{fontSize: 40, lineHeight: 50}}>{e}</Text>
                </Card>
              ))}
            </View>
            <Text variant="hero" style={{marginTop: space.huge}}>
              {item.title}
            </Text>
            <Text variant="body" tone="muted" style={{marginTop: space.md}}>
              {item.body}
            </Text>
          </View>
        )}
      />
      <View style={styles.dots} accessibilityLabel={`Page ${index + 1} of ${SLIDES.length}`}>
        {SLIDES.map((s, i) => (
          <View key={s.title} style={[styles.dot, {backgroundColor: i === index ? colors.accent : colors.borderStrong, width: i === index ? 22 : 8}]} />
        ))}
      </View>
      <View style={{paddingHorizontal: space.xl, gap: space.sm}}>
        {last ? (
          <>
            <Button label="Create an account" size="lg" onPress={() => navigation.navigate('SignUp')} testID="onboarding-signup" />
            <Button label="I already have an account" variant="ghost" onPress={() => navigation.navigate('SignIn')} />
          </>
        ) : (
          <>
            <Button label="Next" size="lg" onPress={() => list.current?.scrollToIndex({index: index + 1})} />
            <Button label="Skip" variant="ghost" onPress={() => list.current?.scrollToIndex({index: SLIDES.length - 1})} />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, overflow: 'hidden'},
  emojiRow: {flexDirection: 'row', justifyContent: 'center', gap: space.md},
  emojiCard: {width: 84, height: 96, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg},
  dots: {flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: space.xl},
  dot: {height: 8, borderRadius: 4},
});
