import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Activity, TrendingDown, TrendingUp, Link2, AlertCircle } from 'lucide-react-native';
import { Text } from './Text';
import { theme } from '../theme';
import type { PersonalPattern, PersonalPatternType } from '@amani/shared';

interface YourPatternsCardProps {
  patterns: PersonalPattern[];
  reportCount: number;
}

function PatternIcon({ pattern }: { pattern: PersonalPattern }) {
  const size = 16;
  if (pattern.type === 'symptom') {
    return <Link2 size={size} color="#B45309" />; // amber-700
  }
  if (pattern.type === 'baseline') {
    return <Activity size={size} color="#0F766E" />; // teal-700
  }
  if (pattern.type === 'trend') {
    const trendDir = pattern.supportingData?.trendResult?.trendDirection;
    if (pattern.severity === 'info' && trendDir === 'falling') {
      return <TrendingDown size={size} color="#059669" />; // emerald-600
    }
    if (pattern.severity === 'info' && trendDir === 'rising') {
      return <TrendingUp size={size} color="#059669" />; // emerald-600
    }
    if (pattern.severity === 'caution') {
      return <AlertCircle size={size} color="#D97706" />; // amber-600
    }
    return <TrendingUp size={size} color="#0284C7" />; // sky-600
  }
  return <Activity size={size} color="#0F766E" />;
}

function getIconContainerStyle(pattern: PersonalPattern) {
  if (pattern.type === 'symptom') return { borderColor: '#FEF3C7' }; // amber-100
  if (pattern.type === 'baseline') return { borderColor: '#CCFBF1' }; // teal-100
  if (pattern.type === 'trend' && pattern.severity === 'info') return { borderColor: '#D1FAE5' }; // emerald-100
  if (pattern.type === 'trend' && pattern.severity === 'caution') return { borderColor: '#FEF3C7' }; // amber-100
  return { borderColor: '#CCFBF1' }; // teal-100
}

const PATTERN_DOT_COLORS: Record<PersonalPatternType, string> = {
  symptom: '#FBBF24', // amber-400
  trend: '#38BDF8', // sky-400
  baseline: '#2DD4BF', // teal-400
};

export function YourPatternsCard({ patterns, reportCount }: YourPatternsCardProps) {
  if (patterns.length === 0) return null;

  const symptomPatterns = patterns.filter((p) => p.type === 'symptom');
  const trendPatterns = patterns.filter((p) => p.type === 'trend');
  const baselinePatterns = patterns.filter((p) => p.type === 'baseline');

  const orderedPatterns = [...symptomPatterns, ...trendPatterns, ...baselinePatterns].slice(0, 3);

  const hasImprovingTrend = trendPatterns.some((p) => p.severity === 'info');
  const hasCautionTrend = trendPatterns.some((p) => p.severity === 'caution');

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerIcon}>
            <Activity size={16} color="#0F766E" />
          </View>
          <View>
            <Text variant="body" weight="bold" style={styles.title}>
              Your Patterns
            </Text>
            <Text variant="caption" style={styles.subtitle}>
              Based on your {reportCount} previous report{reportCount !== 1 ? 's' : ''}
            </Text>
          </View>
        </View>
        <View style={styles.badge}>
          <Text variant="caption" weight="semibold" style={styles.badgeText}>
            {orderedPatterns.length} insight{orderedPatterns.length !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>

      <View style={styles.patternsList}>
        {orderedPatterns.map((pattern, i) => (
          <View key={i} style={styles.patternItem}>
            <View style={[styles.iconContainer, getIconContainerStyle(pattern)]}>
              <PatternIcon pattern={pattern} />
            </View>
            <View style={styles.patternContent}>
              <Text variant="bodySm" style={styles.patternSummary}>
                {pattern.summary}
              </Text>
              {i < orderedPatterns.length - 1 && <View style={styles.separator} />}
            </View>
          </View>
        ))}
      </View>

      <View style={styles.footer}>
        <View style={styles.legendRow}>
          {orderedPatterns.some((p) => p.type === 'symptom') && (
            <View style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: PATTERN_DOT_COLORS.symptom }]} />
              <Text variant="caption" style={styles.legendText}>
                Symptom connection
              </Text>
            </View>
          )}
          {hasImprovingTrend && (
            <View style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: '#34D399' }]} />
              <Text variant="caption" style={styles.legendText}>
                Improving trend
              </Text>
            </View>
          )}
          {hasCautionTrend && (
            <View style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: '#FBBF24' }]} />
              <Text variant="caption" style={styles.legendText}>
                Trend worth watching
              </Text>
            </View>
          )}
          {!hasImprovingTrend && !hasCautionTrend && orderedPatterns.some((p) => p.type === 'trend') && (
            <View style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: PATTERN_DOT_COLORS.trend }]} />
              <Text variant="caption" style={styles.legendText}>
                Trend over time
              </Text>
            </View>
          )}
          {orderedPatterns.some((p) => p.type === 'baseline') && (
            <View style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: PATTERN_DOT_COLORS.baseline }]} />
              <Text variant="caption" style={styles.legendText}>
                vs. your baseline
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#CCFBF1', // teal-100
    backgroundColor: 'rgba(240, 253, 250, 0.4)', // teal-50/40
    overflow: 'hidden',
    marginBottom: theme.spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#CCFBF1',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 14,
    color: '#134E4A', // teal-900
  },
  subtitle: {
    fontSize: 11,
    color: '#0D9488', // teal-600
    marginTop: 2,
  },
  badge: {
    backgroundColor: '#CCFBF1',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 100,
  },
  badgeText: {
    fontSize: 11,
    color: '#0D9488',
  },
  patternsList: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 12,
  },
  patternItem: {
    flexDirection: 'row',
    gap: 12,
  },
  iconContainer: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  patternContent: {
    flex: 1,
  },
  patternSummary: {
    fontSize: 14,
    color: '#134E4A',
    lineHeight: 20,
  },
  separator: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#CCFBF1',
  },
  footer: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 10,
    color: '#0D9488',
  },
});
