import React from 'react';
import {View} from 'react-native';
import {dishEmoji} from '../dishes';
import {useTheme} from '../theme';
import {Gradient} from './Surface';
import {Text} from './Text';

export function DishVisual({name, size = 56, rounded = 18}: {name: string; size?: number; rounded?: number}) {
  const {colors} = useTheme();
  const emoji = dishEmoji(name);
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
