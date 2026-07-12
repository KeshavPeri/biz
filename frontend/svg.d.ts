// Types for importing local .svg files as React components via
// react-native-svg-transformer (see metro.config.js). Each import is a
// react-native-svg component, so it accepts SvgProps (width/height/color/etc).
declare module '*.svg' {
  import type { FC } from 'react';
  import type { SvgProps } from 'react-native-svg';
  const content: FC<SvgProps>;
  export default content;
}
