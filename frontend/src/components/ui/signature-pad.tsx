import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { PanResponder, Platform, Pressable, Text, View, type GestureResponderEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { EASE_OUT, useMotion } from '@/components/motion/use-motion';

// Signature ink (design-tokens ink). Kept as SVG path(s); see buildSvg below.
const STROKE = '#1C1B18';
const STROKE_WIDTH = 2.4;
// Points closer together than this are dropped (B4-12) — raw move-event
// points from a fast, small gesture otherwise render as visible polygon
// facets instead of a smooth line.
const MIN_POINT_DISTANCE = 1.5;

type Point = { x: number; y: number };

/**
 * Turn a set of raw points into one smooth path: a quadratic curve through
 * the midpoint of every consecutive pair, using each raw point as that
 * curve's control point (B4-12) — the standard freehand-smoothing technique,
 * cheaper than resampling and good enough at signature-pad scale.
 */
function smoothPath(points: Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x.toFixed(1)} ${p.y.toFixed(1)} L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const midX = (prev.x + curr.x) / 2;
    const midY = (prev.y + curr.y) / 2;
    d += ` Q ${prev.x.toFixed(1)} ${prev.y.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }
  return d;
}

/**
 * Build a self-contained SVG document from the drawn strokes. Stored inline in
 * `signatures.signature_data` (owner-only RLS + at-rest encryption) — no Storage
 * bucket for MVP (docs/security.md: signatures rely on RLS + managed encryption).
 * All strokes collapse into one <path> with multiple M…Q… subpaths.
 */
function buildSvg(strokes: string[], width: number, height: number): string {
  if (strokes.length === 0 || width === 0) return '';
  const d = strokes.join(' ');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(width)} ${Math.round(height)}" ` +
    `width="${Math.round(width)}" height="${Math.round(height)}">` +
    `<path d="${d}" fill="none" stroke="${STROKE}" stroke-width="${STROKE_WIDTH}" ` +
    `stroke-linecap="round" stroke-linejoin="round"/></svg>`
  );
}

type SignaturePadProps = {
  /** Fires with the full SVG markup after each stroke, or '' when cleared/empty. */
  onChange: (svg: string) => void;
  /**
   * Fires true when a touch starts on the pad, false when it ends. Plain
   * PanResponder capture flags are a JS-thread-only signal — a real native
   * ScrollView's own gesture recognizer can still win a drag before that
   * signal lands (a well-known RN limitation, distinct from web, where
   * "ScrollView" is just a scrolling div with no competing native
   * recognizer). The parent uses this to disable its ScrollView's
   * `scrollEnabled` for the duration of the touch — the reliable fix.
   */
  onDragActiveChange?: (active: boolean) => void;
  height?: number;
};

/**
 * SignaturePad — the DRAW surface for the signature step (mockup `.sigpad`).
 * Captures finger/pointer strokes with PanResponder (works on web + native, no
 * webview) into SVG paths rendered live via react-native-svg. Self-contained:
 * owns its strokes + a Clear control, and emits the composed SVG to the parent.
 */
export function SignaturePad({ onChange, onDragActiveChange, height = 170 }: SignaturePadProps) {
  const { reduce } = useMotion();
  const [strokes, setStrokes] = useState<string[]>([]);
  // In-progress stroke's raw points live in a ref (no stale closures in the
  // responder, and pushing avoids reallocating on every move event), with a
  // forced re-render so it draws live — smoothed (B4-12) — as the finger moves.
  const inProgressPoints = useRef<Point[]>([]);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const size = useRef({ w: 0, h: height });
  const svgOpacity = useSharedValue(1);

  // Guards PanResponder callbacks that can fire after (or during) unmount —
  // e.g. a release/terminate landing just as the Draw↔Type toggle swaps this
  // component out. Without this, a stray callback can still touch refs on a
  // torn-down instance.
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Notify the parent from an EFFECT, never synchronously inside our own
  // setStrokes updater. Calling a parent's setState from inside a child's
  // state-updater can fire mid-render of a DIFFERENT component (React:
  // "Cannot update a component while rendering a different component") —
  // exactly what happened when toggling Draw→Type mid-stroke unmounted this
  // component while onPanResponderRelease's updater tried to call onChange.
  // Effects always run after commit, so this ordering issue can't recur.
  useEffect(() => {
    onChange(buildSvg(strokes, size.current.w, size.current.h));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onChange is a
    // stable setState setter; size is a ref read at commit time, not a dep.
  }, [strokes]);

  const point = (e: GestureResponderEvent): Point => {
    const { locationX, locationY } = e.nativeEvent;
    return { x: locationX, y: locationY };
  };

  // Shared by release AND terminate so an interrupted stroke (e.g. the
  // ScrollView briefly winning the gesture, or an unmount mid-draw) is
  // committed exactly like a normal release — never silently dropped.
  const commitStroke = () => {
    // Always tell the parent the drag ended — even on a forced terminate from
    // unmounting — or its scrollEnabled=false would get stuck forever. This
    // calls the PARENT's setState, not this component's own, so it's safe
    // regardless of isMounted.
    onDragActiveChange?.(false);
    if (!isMounted.current) return;
    // Capture into a plain local BEFORE clearing the ref. setStrokes's updater
    // isn't guaranteed to run before the next line under React's batching — if
    // it read inProgressPoints.current directly, a deferred updater could see
    // the already-cleared [] instead of the finished stroke (produced empty
    // paths in testing: the <path> committed, but with d="").
    const finishedPoints = inProgressPoints.current;
    inProgressPoints.current = [];
    if (finishedPoints.length > 0) {
      setStrokes((prev) => [...prev, smoothPath(finishedPoints)]);
    }
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Capture (not just "should set") so this view claims the gesture
        // BEFORE an ancestor ScrollView (AuthShell wraps every onboarding
        // screen's body in one) can steal a vertical drag.
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Refuse to yield the gesture once claimed — the whole point of a
        // signature pad is that a drag never scrolls the page instead.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          onDragActiveChange?.(true);
          if (!isMounted.current) return;
          if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          inProgressPoints.current = [point(e)];
          redraw();
        },
        onPanResponderMove: (e) => {
          if (!isMounted.current) return;
          const p = point(e);
          const last = inProgressPoints.current[inProgressPoints.current.length - 1];
          if (last) {
            const dx = p.x - last.x;
            const dy = p.y - last.y;
            // Skip points <1.5px apart (B4-12) — otherwise a slow, small move
            // adds a point per frame and the smoothed curve still facets.
            if (dx * dx + dy * dy < MIN_POINT_DISTANCE * MIN_POINT_DISTANCE) return;
          }
          inProgressPoints.current.push(p);
          redraw();
        },
        onPanResponderRelease: commitStroke,
        // Forced termination (e.g. unmount) must commit too, or the stroke is
        // silently lost and the next gesture starts from stale state.
        onPanResponderTerminate: commitStroke,
      }),
    [],
  );

  // Clear fades the ink out (150ms, B4-13) rather than cutting it — a light
  // haptic marks the action, the reset lands once the fade is actually done.
  const clear = () => {
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    const reset = () => {
      setStrokes([]);
      inProgressPoints.current = [];
      redraw();
      svgOpacity.value = 1;
    };
    if (reduce) {
      reset();
      return;
    }
    svgOpacity.value = withTiming(0, { duration: 150, easing: EASE_OUT }, (finished) => {
      if (finished) runOnJS(reset)();
    });
  };

  const svgAnimatedStyle = useAnimatedStyle(() => ({ opacity: svgOpacity.value }));
  const isEmpty = strokes.length === 0 && inProgressPoints.current.length === 0;

  return (
    <View>
      <View
        {...pan.panHandlers}
        onLayout={(e) => {
          size.current = { w: e.nativeEvent.layout.width, h: height };
        }}
        style={{ height }}
        className="overflow-hidden rounded-card border-[1.5px] border-dashed border-cane-3 bg-surface-card"
      >
        <Animated.View style={svgAnimatedStyle} className="absolute inset-0">
          <Svg width="100%" height="100%">
            {strokes.map((d, i) => (
              <Path
                key={i}
                d={d}
                fill="none"
                stroke={STROKE}
                strokeWidth={STROKE_WIDTH}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {inProgressPoints.current.length > 0 ? (
              <Path
                d={smoothPath(inProgressPoints.current)}
                fill="none"
                stroke={STROKE}
                strokeWidth={STROKE_WIDTH}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
          </Svg>
        </Animated.View>
        {isEmpty ? (
          <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
            <Text className="font-geist text-secondary text-ink-3">Sign with your finger</Text>
          </View>
        ) : null}
      </View>

      <Pressable onPress={clear} hitSlop={6} className="mt-2.5 self-start">
        <Text className="font-geist-medium text-secondary text-ink-3 underline">
          Clear and redraw
        </Text>
      </Pressable>
    </View>
  );
}
