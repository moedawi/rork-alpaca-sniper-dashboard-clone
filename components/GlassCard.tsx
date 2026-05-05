import React, { ReactNode } from 'react';
import { View, StyleSheet, ViewStyle, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

interface GlassCardProps {
  children: ReactNode;
  glowColor: string;
  style?: ViewStyle;
  onPress?: () => void;
}

export default function GlassCard({ children, glowColor, style }: GlassCardProps) {
  const glowShadow = Platform.select({
    ios: {
      shadowColor: glowColor,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.35,
      shadowRadius: 12,
    },
    android: {
      elevation: 6,
    },
    web: {
      boxShadow: `0 0 18px 2px ${glowColor}44, 0 0 6px 1px ${glowColor}22`,
    },
    default: {},
  }) as ViewStyle;

  return (
    <View style={[styles.outerGlow, glowShadow, style]}>
      <View style={styles.cardWrapper}>
        <LinearGradient
          colors={[
            `${glowColor}18`,
            `${glowColor}08`,
            'rgba(8,8,18,0.92)',
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        />
        <View style={[styles.topHighlight, { backgroundColor: `${glowColor}12` }]} />
        <View style={styles.content}>
          {children}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerGlow: {
    borderRadius: 16,
  },
  cardWrapper: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    position: 'relative',
  },
  gradient: {
    ...StyleSheet.absoluteFillObject,
  },
  topHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
  },
  content: {
    padding: 16,
  },
});
