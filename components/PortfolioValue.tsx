import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface PortfolioValueProps {
  value: number;
  base: number;
}

const PortfolioValue: React.FC<PortfolioValueProps> = ({ value = 1000, base = 1000 }) => {
  const change = value - base;
  const percentChange = base > 0 ? ((change / base) * 100) : 0;
  const isPositive = change >= 0;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>PORTFOLIO VALUE</Text>
      <Text style={styles.value}>
        ${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}
      </Text>
      <Text style={[styles.change, isPositive ? styles.positive : styles.negative]}>
        {isPositive ? '+' : ''}${change.toFixed(2)} ({isPositive ? '+' : ''}{percentChange.toFixed(2)}%) of ${base} base
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0a0a0a',
    padding: 16,
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  label: {
    color: '#a3a3a3',
    fontSize: 13,
    fontWeight: '600' as const,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  value: {
    color: '#fff',
    fontSize: 42,
    fontWeight: '700' as const,
    marginVertical: 4,
  },
  change: {
    fontSize: 15,
    fontWeight: '600' as const,
  },
  positive: { color: '#22c55e' },
  negative: { color: '#ef4444' },
});

export default PortfolioValue;
