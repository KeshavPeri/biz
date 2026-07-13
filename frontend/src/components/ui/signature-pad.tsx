import { useMemo, useReducer, useRef, useState } from 'react';
import { PanResponder, Pressable, Text, View, type GestureResponderEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';

// Signature ink (design-tokens ink). Kept as SVG path(s); see buildSvg below.
const STROKE = '#1C1B18';
const STROKE_WIDTH = 2.4;

/**
 * Build a self-contained SVG document from the drawn strokes. Stored inline in
 * `signatures.signature_data` (owner-only RLS + at-rest encryption) — no Storage
 * bucket for MVP (docs/security.md: signatures rely on RLS + managed encryption).
 * All strokes collapse into one <path> with multiple M…L… subpaths.
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
  height?: number;
};

/**
 * SignaturePad — the DRAW surface for the signature step (mockup `.sigpad`).
 * Captures finger/pointer strokes with PanResponder (works on web + native, no
 * webview) into SVG paths rendered live via react-native-svg. Self-contained:
 * owns its strokes + a Clear control, and emits the composed SVG to the parent.
 */
export function SignaturePad({ onChange, height = 170 }: SignaturePadProps) {
  const [strokes, setStrokes] = useState<string[]>([]);
  // In-progress stroke lives in a ref (no stale closures in the responder), with
  // a forced re-render so it draws live as the finger moves.
  const inProgress = useRef('');
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const size = useRef({ w: 0, h: height });

  const point = (e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    return `${locationX.toFixed(1)} ${locationY.toFixed(1)}`;
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          inProgress.current = `M ${point(e)}`;
          redraw();
        },
        onPanResponderMove: (e) => {
          inProgress.current += ` L ${point(e)}`;
          redraw();
        },
        onPanResponderRelease: () => {
          if (inProgress.current) {
            setStrokes((prev) => {
              const next = [...prev, inProgress.current];
              onChange(buildSvg(next, size.current.w, size.current.h));
              return next;
            });
          }
          inProgress.current = '';
        },
      }),
    [onChange],
  );

  const clear = () => {
    setStrokes([]);
    inProgress.current = '';
    onChange('');
    redraw();
  };

  const isEmpty = strokes.length === 0 && !inProgress.current;

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
          {inProgress.current ? (
            <Path
              d={inProgress.current}
              fill="none"
              stroke={STROKE}
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
        </Svg>
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
