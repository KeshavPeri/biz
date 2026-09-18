import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * AmbientBackdrop — the fixed, warm off-white ground behind the tab screens. A
 * barely-there teal light from the top-right and a cane warmth rising from the
 * bottom give the cards and the glass dock something to sit over. It is mounted
 * once behind the navigator: it never scrolls, never animates, and never changes
 * on tab switch. Washes stay faint so ink text keeps its full contrast.
 */
export function AmbientBackdrop() {
  return (
    <View pointerEvents="none" style={styles.base}>
      <LinearGradient
        colors={['rgba(0,149,168,0.07)', 'rgba(0,149,168,0)']}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.35, y: 0.45 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['rgba(223,218,207,0)', 'rgba(223,218,207,0.55)']}
        start={{ x: 0.7, y: 0.55 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  base: { ...StyleSheet.absoluteFillObject, backgroundColor: '#FBFAF6' },
});
