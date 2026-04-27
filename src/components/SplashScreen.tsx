// ============================================================
// SplashScreen.tsx — Branded launch screen
// Renders the Silio logo (silo glyph + wordmark) with the
// "BY PAC-TECHNOLOGIES" tagline. Source of truth for the logo
// shape is public/silio.svg — recreated here with Views to
// avoid an SVG runtime dependency.
// ============================================================

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

const BACKGROUND = '#ffffff';
const SILO_COLOR = '#D89E3C';
const WORDMARK_COLOR = '#141413';
const TAGLINE_COLOR = '#6d7788';

// Proportions match silio.svg (silo is 120×120; hole at (60,55) r=22).
const SILO_SIZE = 100;
const HOLE_SIZE = Math.round((SILO_SIZE * 44) / 120);
const HOLE_TOP = Math.round((SILO_SIZE * (55 - 22)) / 120);
const HOLE_LEFT = Math.round((SILO_SIZE - HOLE_SIZE) / 2);

export default function SplashScreen(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <View style={styles.logoRow}>
        <View style={styles.silo}>
          <View style={styles.siloHole} />
        </View>
        <Text style={styles.wordmark}>Silio</Text>
      </View>
      <Text style={styles.tagline}>BY PAC-TECHNOLOGIES</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BACKGROUND,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  silo: {
    width: SILO_SIZE,
    height: SILO_SIZE,
    backgroundColor: SILO_COLOR,
    borderTopLeftRadius: SILO_SIZE / 2,
    borderTopRightRadius: SILO_SIZE / 2,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
  siloHole: {
    position: 'absolute',
    top: HOLE_TOP,
    left: HOLE_LEFT,
    width: HOLE_SIZE,
    height: HOLE_SIZE,
    borderRadius: HOLE_SIZE / 2,
    backgroundColor: BACKGROUND,
  },
  wordmark: {
    marginLeft: 14,
    fontSize: 76,
    fontWeight: '900',
    color: WORDMARK_COLOR,
    letterSpacing: -2,
    includeFontPadding: false,
  },
  tagline: {
    marginTop: 28,
    fontSize: 13,
    fontWeight: '700',
    color: TAGLINE_COLOR,
    letterSpacing: 4,
  },
});
