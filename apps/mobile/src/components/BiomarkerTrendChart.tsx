import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { Card, Text } from './index';
import { theme } from '../theme';

interface TrendPoint {
  label: string;
  value: number;
}

interface BiomarkerTrendChartProps {
  title: string;
  unit: string;
  points: TrendPoint[];
}

export function BiomarkerTrendChart({
  title,
  unit,
  points,
}: BiomarkerTrendChartProps) {
  const [width, setWidth] = useState(0);

  const chart = useMemo(() => {
    if (points.length < 2) {
      return null;
    }

    const values = points.map((point) => point.value);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const padding = maxValue === minValue ? Math.max(1, maxValue * 0.08 || 1) : (maxValue - minValue) * 0.15;
    const chartMin = minValue - padding;
    const chartMax = maxValue + padding;

    return {
      minValue,
      maxValue,
      chartMin,
      chartMax,
      latestDelta: points[points.length - 1].value - points[0].value,
    };
  }, [points]);

  const viewWidth = width || 320;
  const chartHeight = 160;
  const innerWidth = Math.max(viewWidth - 24, 240);
  const innerHeight = chartHeight - 24;

  const gridLines = [0.2, 0.5, 0.8].map((ratio) => innerHeight * ratio);

  const positions = useMemo(() => {
    if (!chart || points.length < 2) {
      return [];
    }

    return points.map((point, index) => {
      const x = points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth;
      const y =
        innerHeight -
        ((point.value - chart.chartMin) / Math.max(chart.chartMax - chart.chartMin, 1)) * innerHeight;
      return { ...point, x, y };
    });
  }, [chart, innerHeight, innerWidth, points]);

  const pathData = positions
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');

  const deltaTone = chart && chart.latestDelta > 0 ? 'warning' : chart && chart.latestDelta < 0 ? 'success' : 'muted';
  const deltaLabel =
    chart && chart.latestDelta !== 0
      ? `${chart.latestDelta > 0 ? '+' : ''}${chart.latestDelta.toFixed(2)} ${unit}`
      : `Stable ${unit}`;

  const handleLayout = (event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  };

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="body" weight="bold">
            {title}
          </Text>
          <Text variant="caption" tone="muted">
            {points.length} reports tracked
          </Text>
        </View>
        <Text variant="bodySm" tone={deltaTone} weight="semibold">
          {deltaLabel}
        </Text>
      </View>

      <View onLayout={handleLayout} style={styles.chartShell}>
        <Svg width={viewWidth} height={chartHeight}>
          {gridLines.map((y) => (
            <Line
              key={y}
              x1={0}
              y1={y}
              x2={innerWidth}
              y2={y}
              stroke={theme.colors.borderSubtle}
              strokeWidth={1}
            />
          ))}

          {positions.length > 1 ? (
            <Path
              d={pathData}
              fill="none"
              stroke={theme.colors.primary}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}

          {positions.map((point, index) => (
            <Circle
              key={`${point.label}-${index}`}
              cx={point.x}
              cy={point.y}
              r={index === positions.length - 1 ? 5 : 4}
              fill={index === positions.length - 1 ? theme.colors.accent : theme.colors.primaryLight}
              stroke={theme.colors.surface}
              strokeWidth={2}
            />
          ))}
        </Svg>
      </View>

      {points.length > 1 ? (
        <View style={styles.footer}>
          <View>
            <Text variant="caption" tone="muted">
              First
            </Text>
            <Text variant="bodySm" weight="semibold">
              {points[0].label}
            </Text>
          </View>
          <View style={styles.footerCenter}>
            <Text variant="caption" tone="muted">
              Range
            </Text>
            <Text variant="bodySm" weight="semibold">
              {chart?.minValue.toFixed(2)} to {chart?.maxValue.toFixed(2)} {unit}
            </Text>
          </View>
          <View style={styles.footerRight}>
            <Text variant="caption" tone="muted">
              Latest
            </Text>
            <Text variant="bodySm" weight="semibold">
              {points[points.length - 1].label}
            </Text>
          </View>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: theme.spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  headerText: {
    flex: 1,
  },
  chartShell: {
    width: '100%',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  footerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  footerRight: {
    alignItems: 'flex-end',
  },
});
