import { useCallback, useRef, useState } from 'react';
import { PanResponder, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

export interface CrosshairPoint {
  x: number;
  y: number;
  price: number;
  timestamp: string;
  pctChange: number;
  dataIndex: number;
}

export function useChartCrosshair(
  prices: number[],
  timestamps: string[],
  width: number,
  height: number,
  plotXOffset: number = 0,
  padTop: number = 0,
  padBottom: number = 0,
) {
  const [crosshair, setCrosshair] = useState<CrosshairPoint | null>(null);
  const lastIdxRef = useRef<number>(-1);
  const isActiveRef = useRef<boolean>(false);

  const dataRef = useRef({ prices, timestamps, width, height, plotXOffset, padTop, padBottom });
  dataRef.current = { prices, timestamps, width, height, plotXOffset, padTop, padBottom };

  const computePoint = useCallback((moveX: number): CrosshairPoint | null => {
    const { prices: ps, timestamps: ts, width: w, height: h, plotXOffset: xOff, padTop: pT, padBottom: pB } = dataRef.current;
    if (ps.length < 2) return null;

    const plotW = w - xOff;
    const plotH = h - pT - pB;
    if (plotW <= 0 || plotH <= 0) return null;

    const clampedTx = Math.max(xOff, Math.min(moveX, w));
    const frac = (clampedTx - xOff) / plotW;
    const rawIdx = Math.round(frac * (ps.length - 1));
    const idx = Math.max(0, Math.min(rawIdx, ps.length - 1));

    const price = ps[idx];
    const minV = Math.min(...ps);
    const maxV = Math.max(...ps);
    const range = maxV - minV || 1;

    const svgX = xOff + (idx / (ps.length - 1)) * plotW;
    const svgY = pT + (1 - (price - minV) / range) * plotH;

    const startPrice = ps[0];
    const pctChange = startPrice !== 0 ? ((price - startPrice) / Math.abs(startPrice)) * 100 : 0;

    return {
      x: svgX,
      y: svgY,
      price,
      timestamp: ts[idx] ?? '',
      pctChange,
      dataIndex: idx,
    };
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => dataRef.current.prices.length >= 2,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: () => isActiveRef.current,
      onMoveShouldSetPanResponderCapture: () => isActiveRef.current,
      onPanResponderGrant: () => {
        isActiveRef.current = true;
        lastIdxRef.current = -1;
      },
      onPanResponderMove: (_, gs) => {
        const pt = computePoint(gs.moveX);
        if (!pt) return;
        if (pt.dataIndex !== lastIdxRef.current) {
          lastIdxRef.current = pt.dataIndex;
          if (Platform.OS !== 'web') {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          }
        }
        setCrosshair(pt);
      },
      onPanResponderRelease: () => {
        isActiveRef.current = false;
        setCrosshair(null);
        lastIdxRef.current = -1;
      },
      onPanResponderTerminate: () => {
        isActiveRef.current = false;
        setCrosshair(null);
        lastIdxRef.current = -1;
      },
    })
  ).current;

  return { crosshair, panResponder };
}
