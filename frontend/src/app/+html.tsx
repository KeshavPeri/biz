import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

// Web-only document shell. Expo's default leaves <body> unpainted, so iPhone Safari
// tinted its status-bar/toolbar areas pure white against the warm app ground.
// `viewport-fit=cover` exposes real env(safe-area-inset-*) values so the safe-area
// context (and the floating dock) clears the home indicator on mobile web.
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        <meta name="theme-color" content="#FBFAF6" />
        <ScrollViewStyleReset />
        <style
          dangerouslySetInnerHTML={{
            __html: "html,body{background-color:#FBFAF6;}",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
