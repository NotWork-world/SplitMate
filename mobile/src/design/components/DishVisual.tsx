import React from 'react';
import {View} from 'react-native';
import {dishEmoji} from '../dishes';
import {useTheme} from '../theme';
import {Gradient} from './Surface';
import {Text} from './Text';

/**
 * Dish illustration that always matches the dish name (never an unrelated photo).
 * `wide` draws a serving board with a plate, used on the swipe cards.
 */
export function DishVisual({name, size = 56, rounded = 18, wide}: {name: string; size?: number; rounded?: number; wide?: boolean}) {
  const {colors} = useTheme();
  const emoji = dishEmoji(name);
  if (wide) {
    const plate = size * 0.82;
    return (
      <View
        accessible
        accessibilityLabel={`${name} illustration`}
        style={{height: size, borderRadius: rounded, overflow: 'hidden', alignItems: 'center', justifyContent: 'center'}}>
        <Gradient colors={['#EEF5CF', '#D9E99A']} />
        <View
          style={{
            width: plate,
            height: plate,
            borderRadius: plate / 2,
            backgroundColor: '#F7F4EE',
            borderWidth: plate * 0.06,
            borderColor: '#FFFFFF',
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#000',
            shadowOpacity: 0.35,
            shadowRadius: 12,
            shadowOffset: {width: 0, height: 6},
            elevation: 6,
          }}>
          <Text style={{fontSize: plate * 0.5, lineHeight: plate * 0.62}}>{emoji}</Text>
        </View>
      </View>
    );
  }
  return (
    <View
      accessible
      accessibilityLabel={`${name} illustration`}
      style={{width: size, height: size, borderRadius: rounded, overflow: 'hidden', alignItems: 'center', justifyContent: 'center'}}>
      <Gradient colors={[colors.foodSoft, colors.accentSoft]} />
      <Text style={{fontSize: size * 0.5, lineHeight: size * 0.62}}>{emoji}</Text>
    </View>
  );
}
