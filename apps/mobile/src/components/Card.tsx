import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { theme } from '../theme';

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}

export function Card({ children, style, padded = true }: CardProps) {
  return (
    <View style={[styles.card, padded ? styles.padded : null, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.md,
    borderWidth: theme.borders.thin,
    borderColor: theme.colors.border,
    ...theme.shadows.card,
  },
  padded: {
    padding: theme.spacing.md,
  },
});
