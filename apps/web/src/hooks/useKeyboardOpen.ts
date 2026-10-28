import { useEffect, useState, type CSSProperties } from "react";
import { isKeyboardOpen, keepSettling, termRootStyle } from "@/lib/terminal/keyboardInset";

interface Band {
  open: boolean;
  rootStyle: CSSProperties | undefined;
}

function readBand(): Band {
  const vv = typeof window === "undefined" ? null : window.visualViewport;
  if (!vv) return { open: false, rootStyle: undefined };
  return {
    open: isKeyboardOpen({ layoutHeight: window.innerHeight, visualHeight: vv.height }),
    rootStyle: termRootStyle({ height: vv.height, offsetTop: vv.offsetTop }),
  };
}

function sameBand(a: Band, b: Band): boolean {
  return (
    a.open === b.open &&
    a.rootStyle?.height === b.rootStyle?.height &&
    a.rootStyle?.transform === b.rootStyle?.transform
  );
}

/**
 * The visible band, for the terminal's fixed root: whether the mobile keyboard is up
 * (`open`, which hides the header) and the style that pins the root to the band above
 * it (`rootStyle`; undefined without `visualViewport`, where the CSS `100dvh` stands).
 *
 * Both come out of one state update on purpose: the root's height and the keyboard flag
 * commit in the same render, so the terminal's ResizeObserver never sees the box shrink
 * under the keyboard while still believing it is closed — which would re-fit the pty to
 * the band, the very reflow `syncGeometry` refuses while the keyboard is up.
 *
 * Every viewport event starts a settle run: iOS moves the band after its last event, so
 * the band is re-read every 250ms until it stops changing (`keepSettling`).
 */
export function useKeyboardOpen(): Band {
  const [band, setBand] = useState(readBand);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastBand = -1;
    let passes = 0;
    const pass = () => {
      const height = Math.round(vv.height);
      const next = readBand();
      setBand((prev) => (sameBand(prev, next) ? prev : next));
      if (keepSettling({ band: height, lastBand, passes })) {
        lastBand = height;
        passes += 1;
        clearTimeout(timer);
        timer = setTimeout(pass, 250);
      }
    };
    const restart = () => {
      lastBand = -1;
      passes = 0;
      clearTimeout(timer);
      pass();
    };
    vv.addEventListener("resize", restart);
    vv.addEventListener("scroll", restart);
    restart();
    return () => {
      clearTimeout(timer);
      vv.removeEventListener("resize", restart);
      vv.removeEventListener("scroll", restart);
    };
  }, []);

  return band;
}
