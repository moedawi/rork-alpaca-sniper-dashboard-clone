import React, { useMemo } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import Svg, { Polyline, Line, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import Colors from '@/constants/colors';

interface PnlChartProps {
  data: { x: string; y: number }[];
  width: number;
  height: number;
}

export default function PnlChart({ data, width, height }: PnlChartProps) {
  const padding = { top: 20, bottom: 30, left: 12, right: 12 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const { points, minY, maxY, zeroY } = useMemo(() => {
    if (data.length === 0) {
      return { points: '', minY: 0, maxY: 0, zeroY: 0 };
    }

    const yValues = data.map((d) => d.y);
    const minVal = Math.min(...yValues, 0);
    const maxVal = Math.max(...yValues, 0);
    const range = maxVal - minVal || 1;

    const pts = data
      .map((d, i) => {
        const x = padding.left + (i / Math.max(data.length - 1, 1)) * chartW;
        const y = padding.top + chartH - ((d.y - minVal) / range) * chartH;
        return `${x},${y}`;
      })
      .join(' ');

    const zLine = padding.top + chartH - ((0 - minVal) / range) * chartH;

    return { points: pts, minY: minVal, maxY: maxVal, zeroY: zLine };
  }, [data, chartW, chartH, padding.left, padding.top]);

  const lastPoint = useMemo(() => {
    if (data.length === 0) return null;
    const yValues = data.map((d) => d.y);
    const minVal = Math.min(...yValues, 0);
    const maxVal = Math.max(...yValues, 0);
    const range = maxVal - minVal || 1;
    const last = data[data.length - 1];
    const x = padding.left + ((data.length - 1) / Math.max(data.length - 1, 1)) * chartW;
    const y = padding.top + chartH - ((last.y - minVal) / range) * chartH;
    return { x, y, value: last.y };
  }, [data, chartW, chartH, padding.left, padding.top]);

  if (data.length === 0) {
    return (
      <View style={[styles.container, { width, height }]}>
        <Text style={styles.emptyText}>No trade data yet</Text>
      </View>
    );
  }

  const isPositive = data[data.length - 1]?.y >= 0;
  const strokeColor = isPositive ? Colors.accent : Colors.red;

  return (
    <View style={[styles.container, { width, height }]}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={strokeColor} stopOpacity="0.15" />
            <Stop offset="1" stopColor={strokeColor} stopOpacity="0" />
          </LinearGradient>
        </Defs>

        <Line
          x1={padding.left}
          y1={zeroY}
          x2={width - padding.right}
          y2={zeroY}
          stroke={Colors.textTertiary}
          strokeWidth={0.5}
          strokeDasharray="4,4"
        />

        <Polyline
          points={points}
          fill="none"
          stroke={strokeColor}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {lastPoint && (
          <>
            <Circle
              cx={lastPoint.x}
              cy={lastPoint.y}
              r={4}
              fill={strokeColor}
            />
            <Circle
              cx={lastPoint.x}
              cy={lastPoint.y}
              r={8}
              fill={strokeColor}
              opacity={0.2}
            />
          </>
        )}
      </Svg>

      <View style={styles.labels}>
        <Text style={styles.labelText}>{maxY.toFixed(1)}%</Text>
        <Text style={styles.labelText}>{minY.toFixed(1)}%</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative' as const,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 14,
    textAlign: 'center' as const,
    marginTop: 60,
  },
  labels: {
    position: 'absolute' as const,
    right: 16,
    top: 16,
    bottom: 30,
    justifyContent: 'space-between' as const,
  },
  labelText: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontVariant: ['tabular-nums' as const],
  },
});
