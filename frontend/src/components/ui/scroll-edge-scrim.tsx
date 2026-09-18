import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";

// bg.app at high alpha: reads as the page itself, not a pane, while keeping text crisp.
const GROUND = "rgba(251,250,246,0.94)";
const GROUND_CLEAR = "rgba(251,250,246,0)";

/**
 * ScrollEdgeScrim — the backing for a header that content scrolls beneath. At rest
 * (`progress` 0) it is invisible, so the header sits directly on the page; once
 * content passes underneath it fades in as the page ground plus a 16pt soft edge,
 * so cards dissolve under the header instead of being sliced by a hard line.
 * Absolute layer: place it first inside the header container.
 */
export function ScrollEdgeScrim({
  progress,
}: {
  progress: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => ({ opacity: progress.value }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, style]}
    >
      <View style={[StyleSheet.absoluteFill, { backgroundColor: GROUND }]} />
      <LinearGradient colors={[GROUND, GROUND_CLEAR]} style={styles.edge} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  edge: { position: "absolute", left: 0, right: 0, top: "100%", height: 16 },
});
