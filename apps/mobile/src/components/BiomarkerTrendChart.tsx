import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { LineChart } from 'react-native-wagmi-charts';
import { Card, Text } from './index';
import { theme } from '../theme';

interface TrendPoint {
  label: string;
  timestamp: number;
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

  const chartData = useMemo(
    () =>
      points.map((point) => ({
        timestamp: point.timestamp,
        value: point.value,
      })),
    [points]
  );

  const summary = useMemo(() => {
    if (chartData.length < 2) {
      return null;
    }

    const values = chartData.map((point) => point.value);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const padding =
      maxValue === minValue
        ? Math.max(1, Math.abs(maxValue) * 0.08 || 1)
        : (maxValue - minValue) * 0.15;

    return {
      minValue,
      maxValue,
      chartMin: minValue - padding,
      chartMax: maxValue + padding,
      latestDelta: chartData[chartData.length - 1].value - chartData[0].value,
    };
  }, [chartData]);

  const chartWidth = Math.max(width - theme.spacing.md * 2, 240);
  const chartHeight = 220;
  const deltaTone =
    summary && summary.latestDelta > 0
      ? 'warning'
      : summary && summary.latestDelta < 0
        ? 'success'
        : 'muted';
  const deltaLabel =
    summary && summary.latestDelta !== 0
      ? `${summary.latestDelta > 0 ? '+' : ''}${summary.latestDelta.toFixed(2)} ${unit}`
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
        {summary ? (
          <LineChart.Provider
            data={chartData}
            yRange={{ min: summary.chartMin, max: summary.chartMax }}
          >
            <LineChart width={chartWidth} height={chartHeight} style={styles.chart}>
              <LineChart.Path color={theme.colors.primary} width={3}>
                <LineChart.Gradient color={`${theme.colors.primary}55`} />
                <LineChart.Dot
                  at={0}
                  color={theme.colors.primaryLight}
                  size={8}
                  hasPulse={false}
                />
                <LineChart.Dot
                  at={chartData.length - 1}
                  color={theme.colors.accent}
                  size={10}
                  hasPulse
                />
              </LineChart.Path>
            </LineChart>
          </LineChart.Provider>
        ) : null}
      </View>

      {summary ? (
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
              {summary.minValue.toFixed(2)} to {summary.maxValue.toFixed(2)} {unit}
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
    minHeight: 220,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.backgroundTint,
    borderWidth: theme.borders.thin,
    borderColor: theme.colors.borderSubtle,
  },
  chart: {
    alignSelf: 'center',
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
