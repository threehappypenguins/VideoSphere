// ── Pre-set seeds ──────────────────────────────────────────────────────────────
// Deterministic per-route seeds so each page gets a unique but stable noise
// pattern. These are resolved at build time — no client JS required.

/**
 * Defines the PAGE_SEEDS constant.
 */
export const PAGE_SEEDS: Record<string, number> = {
  // Marketing
  '/': 42,
  '/test-background': 77,
  // Auth
  '/login': 603,
  '/setup': 812,
  '/invite': 721,
  // Dashboard
  '/dashboard': 137,
  '/dashboard/drafts': 1088,
  '/dashboard/history': 1201,
  // Profile
  '/profile': 256,
  '/profile/connections': 1345,
};

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Defines the BlendMode type.
 */
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'plus-lighter';

const ALLOWED_BLEND_MODES: ReadonlySet<string> = new Set<BlendMode>([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'plus-lighter',
]);

interface GaussianNoiseBackgroundProps {
  className?: string;
  /** Seed for the noise RNG — determines cloud shape. Use PAGE_SEEDS for per-route consistency. */
  seed?: number;
  /** CSS mix-blend-mode for compositing the grain layer onto the cloud layer. */
  blendMode?: BlendMode;
  /** Opacity of the Perlin cloud layer (0–1). */
  cloudOpacity?: number;
  /** Opacity of the grain overlay layer (0–1). */
  grainOpacity?: number;
  /** Number of octaves for the cloud noise (1–8). More octaves = more detail / complexity. */
  harmony?: number;
  /** Controls the visual strength of the cloud noise — maps to the cloud layer opacity multiplier (0–1). */
  amplitude?: number;
  /** Base frequency of the cloud noise — lower = larger blobs, higher = tighter pattern (e.g. 0.0003–0.01). */
  spread?: number;
  /** Contrast slope for the cloud noise. Higher = more contrast (default 1). Values 2–5 give dramatic contrast. */
  contrast?: number;
  /** Brightness shift for the cloud noise after contrast is applied (−1 to 1, default 0). Negative = darker. */
  brightness?: number;
  /** Strength of subtle alpha dithering for cloud mask anti-banding (0–0.25). */
  ditherStrength?: number;
  /** Number of octaves for the grain noise (1–8). More octaves = finer detail. */
  grainHarmony?: number;
  /** Base frequency of the grain noise — higher = finer grain (e.g. 0.5–2.0). */
  grainSpread?: number;
  /** Contrast slope for the grain noise. */
  grainContrast?: number;
  /** Brightness shift for the grain noise. */
  grainBrightness?: number;
}

// ── Card / Modal variant ───────────────────────────────────────────────────────
// Same noise pipeline as GaussianNoiseBackground but:
//  • Positioned absolute (fills its nearest positioned ancestor — card, modal…)
//  • Perlin cloud and grain layers are coloured with --secondary instead of the
//    foreground, so the noise blends from the page background to the secondary
//    brand colour.
//  • rounded-[inherit] so the noise is clipped to the parent's border-radius.
//
// Usage: place as the *first* child of a card/modal and ensure the parent has
// `relative isolate overflow-hidden`. The `isolate` creates a stacking context
// so the component's `-z-10` is scoped inside the card, not the page.
//
//   <div className="relative overflow-hidden rounded-xl …">
//     <CardNoiseBackground seed={PAGE_SEEDS['/dashboard']} />
//     {/* card content */}
//   </div>

/**
 * Renders the card noise background component.
 * @param props - Component props.
 * @returns The rendered UI output.
 */
export function CardNoiseBackground({
  className = '',
  seed = 42,
  blendMode = 'soft-light',
  cloudOpacity = 1,
  grainOpacity = 1,
  harmony = 3,
  amplitude = 1,
  spread = 0.0013,
  contrast = 3,
  brightness = -0.4,
  ditherStrength = 0.08,
  grainHarmony = 4,
  grainSpread = 0.6,
  grainContrast = 5,
  grainBrightness = -0.2,
}: GaussianNoiseBackgroundProps) {
  const clampedHarmony = Math.max(1, Math.min(8, Math.round(harmony)));
  const clampedGrainHarmony = Math.max(1, Math.min(8, Math.round(grainHarmony)));
  const clampedAmplitude = Math.max(0, Math.min(1, amplitude));
  const clampedDitherStrength = Math.max(0, Math.min(0.25, ditherStrength));
  const safeBlend = ALLOWED_BLEND_MODES.has(blendMode) ? blendMode : 'soft-light';

  const cloudIntercept = (1 - contrast) / 2 + brightness;
  const grainIntercept = (1 - grainContrast) / 2 + grainBrightness;

  const cloudFilterId = `card-perlin-${seed}`;
  const grainFilterId = `card-grain-${seed}`;

  return (
    <div
      className={`absolute inset-0 -z-10 overflow-hidden rounded-[inherit] ${className}`}
      aria-hidden="true"
    >
      {/* Perlin cloud layer — secondary-coloured, masked by fractal noise */}
      <svg
        className="absolute inset-0 h-full w-full text-[var(--card-noise-color)]"
        style={{ opacity: cloudOpacity * clampedAmplitude }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter id={cloudFilterId} x="0%" y="0%" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency={spread}
              numOctaves={clampedHarmony}
              seed={seed}
              stitchTiles="stitch"
              result="turb"
            />
            <feColorMatrix type="luminanceToAlpha" in="turb" result="alpha" />
            <feComponentTransfer in="alpha" result="curved">
              <feFuncA type="linear" slope={contrast} intercept={cloudIntercept} />
            </feComponentTransfer>
            <feGaussianBlur in="curved" stdDeviation="3" result="smooth" />
            <feTurbulence
              type="fractalNoise"
              baseFrequency="1.6"
              numOctaves="1"
              seed={seed + 2000}
              stitchTiles="stitch"
              result="dither"
            />
            <feColorMatrix type="luminanceToAlpha" in="dither" result="ditherAlpha" />
            <feComponentTransfer in="ditherAlpha" result="ditherCentered">
              <feFuncA
                type="linear"
                slope={clampedDitherStrength}
                intercept={-clampedDitherStrength / 2}
              />
            </feComponentTransfer>
            <feComposite
              in="smooth"
              in2="ditherCentered"
              operator="arithmetic"
              k2="1"
              k3="1"
              result="dithered"
            />
            <feComposite in="SourceGraphic" in2="dithered" operator="in" />
          </filter>
        </defs>
        <rect width="100%" height="100%" fill="currentColor" filter={`url(#${cloudFilterId})`} />
      </svg>

      {/* Gaussian grain layer — secondary-coloured fine noise, blended onto clouds */}
      <svg
        className="absolute inset-0 h-full w-full text-[var(--card-noise-color)]"
        style={{ mixBlendMode: safeBlend, opacity: grainOpacity }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter id={grainFilterId} x="0%" y="0%" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency={grainSpread}
              numOctaves={clampedGrainHarmony}
              seed={seed + 1000}
              stitchTiles="stitch"
              result="turb"
            />
            <feColorMatrix type="luminanceToAlpha" in="turb" result="alpha" />
            <feComponentTransfer in="alpha" result="curved">
              <feFuncA type="linear" slope={grainContrast} intercept={grainIntercept} />
            </feComponentTransfer>
            <feComposite in="SourceGraphic" in2="curved" operator="in" />
          </filter>
        </defs>
        <rect width="100%" height="100%" fill="currentColor" filter={`url(#${grainFilterId})`} />
      </svg>
    </div>
  );
}

// ── Component (Server) ────────────────────────────────────────────────────────
// Fully server-rendered via SVG feTurbulence — no client JS, no canvas,
// no useEffect. The browser's SVG filter pipeline handles noise generation
// on the GPU. Seeds baked into the markup guarantee deterministic output.

/**
 * Renders the gaussian noise background component.
 * @param props - Component props.
 * @returns The rendered UI output.
 */
export function GaussianNoiseBackground({
  className = '',
  seed = 42,
  blendMode = 'soft-light',
  cloudOpacity = 1,
  grainOpacity = 1,
  harmony = 3,
  amplitude = 1,
  spread = 0.0013,
  contrast = 3,
  brightness = -0.4,
  ditherStrength = 0.08,
  grainHarmony = 4,
  grainSpread = 0.6,
  grainContrast = 5,
  grainBrightness = -0.2,
}: GaussianNoiseBackgroundProps) {
  const clampedHarmony = Math.max(1, Math.min(8, Math.round(harmony)));
  const clampedGrainHarmony = Math.max(1, Math.min(8, Math.round(grainHarmony)));
  const clampedAmplitude = Math.max(0, Math.min(1, amplitude));
  const clampedDitherStrength = Math.max(0, Math.min(0.25, ditherStrength));
  const safeBlend = ALLOWED_BLEND_MODES.has(blendMode) ? blendMode : 'soft-light';

  // Linear transfer: output = slope * input + intercept
  // To center contrast around midpoint: intercept = (1 - slope) / 2 + brightness
  const cloudIntercept = (1 - contrast) / 2 + brightness;
  const grainIntercept = (1 - grainContrast) / 2 + grainBrightness;

  const cloudFilterId = `perlin-${seed}`;
  const grainFilterId = `grain-${seed}`;

  return (
    <div className={`fixed inset-0 -z-10 bg-background ${className}`} aria-hidden="true">
      {/* Perlin cloud layer — foreground-colored, masked by fractal noise */}
      <svg
        className="absolute inset-0 h-full w-full text-black dark:text-white"
        style={{ opacity: cloudOpacity * clampedAmplitude }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter id={cloudFilterId} x="0%" y="0%" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency={spread}
              numOctaves={clampedHarmony}
              seed={seed}
              stitchTiles="stitch"
              result="turb"
            />
            <feColorMatrix type="luminanceToAlpha" in="turb" result="alpha" />
            <feComponentTransfer in="alpha" result="curved">
              <feFuncA type="linear" slope={contrast} intercept={cloudIntercept} />
            </feComponentTransfer>
            <feGaussianBlur in="curved" stdDeviation="3" result="smooth" />
            <feTurbulence
              type="fractalNoise"
              baseFrequency="1.6"
              numOctaves="1"
              seed={seed + 2000}
              stitchTiles="stitch"
              result="dither"
            />
            <feColorMatrix type="luminanceToAlpha" in="dither" result="ditherAlpha" />
            <feComponentTransfer in="ditherAlpha" result="ditherCentered">
              <feFuncA
                type="linear"
                slope={clampedDitherStrength}
                intercept={-clampedDitherStrength / 2}
              />
            </feComponentTransfer>
            <feComposite
              in="smooth"
              in2="ditherCentered"
              operator="arithmetic"
              k2="1"
              k3="1"
              result="dithered"
            />
            <feComposite in="SourceGraphic" in2="dithered" operator="in" />
          </filter>
        </defs>
        <rect width="100%" height="100%" fill="currentColor" filter={`url(#${cloudFilterId})`} />
      </svg>

      {/* Gaussian grain layer — foreground-colored fine noise, blended onto clouds */}
      <svg
        className="absolute inset-0 h-full w-full text-black dark:text-white"
        style={{ mixBlendMode: safeBlend, opacity: grainOpacity }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter id={grainFilterId} x="0%" y="0%" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency={grainSpread}
              numOctaves={clampedGrainHarmony}
              seed={seed + 1000}
              stitchTiles="stitch"
              result="turb"
            />
            <feColorMatrix type="luminanceToAlpha" in="turb" result="alpha" />
            <feComponentTransfer in="alpha" result="curved">
              <feFuncA type="linear" slope={grainContrast} intercept={grainIntercept} />
            </feComponentTransfer>
            <feComposite in="SourceGraphic" in2="curved" operator="in" />
          </filter>
        </defs>
        <rect width="100%" height="100%" fill="currentColor" filter={`url(#${grainFilterId})`} />
      </svg>
    </div>
  );
}
