import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
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
  const [strokes, setStrokes] = useState<string[]>([]);
  // In-progress stroke lives in a ref (no stale closures in the responder), with
  // a forced re-render so it draws live as the finger moves.
  const inProgress = useRef('');
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const size = useRef({ w: 0, h: height });

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

  const point = (e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    return `${locationX.toFixed(1)} ${locationY.toFixed(1)}`;
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
    // it read inProgress.current directly, a deferred updater could see the
    // already-cleared '' instead of the finished stroke (produced empty paths
    // in testing: the <path> committed, but with d="").
    const finished = inProgress.current;
    inProgress.current = '';
    if (finished) {
      setStrokes((prev) => [...prev, finished]);
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
          inProgress.current = `M ${point(e)}`;
          redraw();
        },
        onPanResponderMove: (e) => {
          if (!isMounted.current) return;
          inProgress.current += ` L ${point(e)}`;
          redraw();
        },
        onPanResponderRelease: commitStroke,
        // Forced termination (e.g. unmount) must commit too, or the stroke is
        // silently lost and the next gesture starts from stale state.
        onPanResponderTerminate: commitStroke,
      }),
    [],
  );

  const clear = () => {
    setStrokes([]);
    inProgress.current = '';
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
