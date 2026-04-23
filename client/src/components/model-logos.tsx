/**
 * Inline brand SVG logos for every LLM/model provider we integrate with.
 *
 * Usage:
 *   <OpenAiLogo size={28} />
 *   <PerplexityLogo size={24} className="opacity-70" />
 *
 * Or dispatch by model key (for iterating over modelsConfig etc.):
 *   <ModelLogo model="openai-api" size={28} />
 *
 * Keep SVGs self-contained and free of external references so they render
 * correctly when copy-pasted into any host (tooltips, tables, mentions).
 */

export interface LogoProps {
  /** Sets width and height in pixels. Defaults to 24. */
  size?: number;
  className?: string;
  /** Accessible label. Defaults to the brand name. */
  title?: string;
}

const svgBase = (size: number) => ({
  width: size,
  height: size,
  xmlns: 'http://www.w3.org/2000/svg',
});

// ─── OpenAI / ChatGPT ────────────────────────────────────────────
export function OpenAiLogo({ size = 24, className, title = 'OpenAI' }: LogoProps) {
  return (
    <svg
      {...svgBase(size)}
      viewBox="0 0 512 512"
      className={className}
      role="img"
      aria-label={title}
      fillRule="evenodd"
      clipRule="evenodd"
      strokeLinejoin="round"
      strokeMiterlimit={2}
    >
      <title>{title}</title>
      <path
        fillRule="nonzero"
        fill="currentColor"
        d="M474.123 209.81c11.525-34.577 7.569-72.423-10.838-103.904-27.696-48.168-83.433-72.94-137.794-61.414a127.14 127.14 0 00-95.475-42.49c-55.564 0-104.936 35.781-122.139 88.593-35.781 7.397-66.574 29.76-84.637 61.414-27.868 48.167-21.503 108.72 15.826 150.007-11.525 34.578-7.569 72.424 10.838 103.733 27.696 48.34 83.433 73.111 137.966 61.585 24.084 27.18 58.833 42.835 95.303 42.663 55.564 0 104.936-35.782 122.139-88.594 35.782-7.397 66.574-29.76 84.465-61.413 28.04-48.168 21.676-108.722-15.654-150.008v-.172zm-39.567-87.218c11.01 19.267 15.139 41.803 11.354 63.65-.688-.516-2.064-1.204-2.924-1.72l-101.152-58.49a16.965 16.965 0 00-16.687 0L206.621 194.5v-50.232l97.883-56.597c45.587-26.32 103.732-10.666 130.052 34.921zm-227.935 104.42l49.888-28.9 49.887 28.9v57.63l-49.887 28.9-49.888-28.9v-57.63zm23.223-191.81c22.364 0 43.867 7.742 61.07 22.02-.688.344-2.064 1.204-3.097 1.72L186.666 117.26c-5.161 2.925-8.258 8.43-8.258 14.45v136.934l-43.523-25.116V130.333c0-52.64 42.491-95.13 95.131-95.302l-.172.172zM52.14 168.697c11.182-19.268 28.557-34.062 49.544-41.803V247.14c0 6.02 3.097 11.354 8.258 14.45l118.354 68.295-43.695 25.288-97.711-56.425c-45.415-26.32-61.07-84.465-34.75-130.052zm26.665 220.71c-11.182-19.095-15.139-41.802-11.354-63.65.688.516 2.064 1.204 2.924 1.72l101.152 58.49a16.965 16.965 0 0016.687 0l118.354-68.467v50.232l-97.883 56.425c-45.587 26.148-103.732 10.665-130.052-34.75h.172zm204.54 87.39c-22.192 0-43.867-7.741-60.898-22.02a62.439 62.439 0 003.097-1.72l101.152-58.317c5.16-2.924 8.429-8.43 8.257-14.45V243.527l43.523 25.116v113.022c0 52.64-42.663 95.303-95.131 95.303v-.172zM461.22 343.303c-11.182 19.267-28.729 34.061-49.544 41.63V264.687c0-6.021-3.097-11.526-8.257-14.45L284.893 181.77l43.523-25.116 97.883 56.424c45.587 26.32 61.07 84.466 34.75 130.053l.172.172z"
      />
    </svg>
  );
}
// Same brand mark is used for ChatGPT — alias for readability at call sites.
export const ChatGptLogo = OpenAiLogo;

// ─── Anthropic (wordmark-style A) ────────────────────────────────
export function AnthropicLogo({ size = 24, className, title = 'Anthropic' }: LogoProps) {
  return (
    <svg {...svgBase(size)} viewBox="0 0 24 24" className={className} role="img" aria-label={title}>
      <title>{title}</title>
      <path
        fill="currentColor"
        d="M17.304 3.541h-3.672l6.696 16.918H24Zm-10.608 0L0 20.459h3.744l1.37-3.553h7.005l1.369 3.553h3.744L10.536 3.541Zm-.371 10.223L8.616 7.82l2.291 5.945Z"
      />
    </svg>
  );
}

// ─── Claude (product mark — orange rounded square + star) ────────
export function ClaudeLogo({ size = 24, className, title = 'Claude' }: LogoProps) {
  // The path draws the orange tile edge-to-edge in its native viewBox.
  // We inset the viewBox by ~7% on each side so the rendered mark leaves the
  // same visual whitespace around it as the line-art logos (OpenAI, Perplexity).
  return (
    <svg
      {...svgBase(size)}
      viewBox="-40 -40 592 589.64"
      className={className}
      role="img"
      aria-label={title}
      shapeRendering="geometricPrecision"
      textRendering="geometricPrecision"
      imageRendering="optimizeQuality"
    >
      <title>{title}</title>
      <path
        fill="#D77655"
        d="M115.612 0h280.775C459.974 0 512 52.026 512 115.612v278.415c0 63.587-52.026 115.612-115.613 115.612H115.612C52.026 509.639 0 457.614 0 394.027V115.612C0 52.026 52.026 0 115.612 0z"
      />
      <path
        fill="#FCF2EE"
        fillRule="nonzero"
        d="M142.27 316.619l73.655-41.326 1.238-3.589-1.238-1.996-3.589-.001-12.31-.759-42.084-1.138-36.498-1.516-35.361-1.896-8.897-1.895-8.34-10.995.859-5.484 7.482-5.03 10.717.935 23.683 1.617 35.537 2.452 25.782 1.517 38.193 3.968h6.064l.86-2.451-2.073-1.517-1.618-1.517-36.776-24.922-39.81-26.338-20.852-15.166-11.273-7.683-5.687-7.204-2.451-15.721 10.237-11.273 13.75.935 3.513.936 13.928 10.716 29.749 23.027 38.848 28.612 5.687 4.727 2.275-1.617.278-1.138-2.553-4.271-21.13-38.193-22.546-38.848-10.035-16.101-2.654-9.655c-.935-3.968-1.617-7.304-1.617-11.374l11.652-15.823 6.445-2.073 15.545 2.073 6.547 5.687 9.655 22.092 15.646 34.78 24.265 47.291 7.103 14.028 3.791 12.992 1.416 3.968 2.449-.001v-2.275l1.997-26.641 3.69-32.707 3.589-42.084 1.239-11.854 5.863-14.206 11.652-7.683 9.099 4.348 7.482 10.716-1.036 6.926-4.449 28.915-8.72 45.294-5.687 30.331h3.313l3.792-3.791 15.342-20.372 25.782-32.227 11.374-12.789 13.27-14.129 8.517-6.724 16.1-.001 11.854 17.617-5.307 18.199-16.581 21.029-13.75 17.819-19.716 26.54-12.309 21.231 1.138 1.694 2.932-.278 44.536-9.479 24.062-4.347 28.714-4.928 12.992 6.066 1.416 6.167-5.106 12.613-30.71 7.583-36.018 7.204-53.636 12.689-.657.48.758.935 24.164 2.275 10.337.556h25.301l47.114 3.514 12.309 8.139 7.381 9.959-1.238 7.583-18.957 9.655-25.579-6.066-59.702-14.205-20.474-5.106-2.83-.001v1.694l17.061 16.682 31.266 28.233 39.152 36.397 1.997 8.999-5.03 7.102-5.307-.758-34.401-25.883-13.27-11.651-30.053-25.302-1.996-.001v2.654l6.926 10.136 36.574 54.975 1.895 16.859-2.653 5.485-9.479 3.311-10.414-1.895-21.408-30.054-22.092-33.844-17.819-30.331-2.173 1.238-10.515 113.261-4.929 5.788-11.374 4.348-9.478-7.204-5.03-11.652 5.03-23.027 6.066-30.052 4.928-23.886 4.449-29.674 2.654-9.858-.177-.657-2.173.278-22.37 30.71-34.021 45.977-26.919 28.815-6.445 2.553-11.173-5.789 1.037-10.337 6.243-9.2 37.257-47.392 22.47-29.371 14.508-16.961-.101-2.451h-.859l-98.954 64.251-17.618 2.275-7.583-7.103.936-11.652 3.589-3.791 29.749-20.474-.101.102.024.101z"
      />
    </svg>
  );
}

// ─── Perplexity ──────────────────────────────────────────────────
export function PerplexityLogo({ size = 24, className, title = 'Perplexity' }: LogoProps) {
  return (
    <svg {...svgBase(size)} viewBox="0 0 24 24" className={className} role="img" aria-label={title}>
      <title>{title}</title>
      <path
        fill="currentColor"
        d="M22.3977 7.0896h-2.3106V0.0676l-7.5094 6.3542V0.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932 -6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657 -4.531v4.531h-5.355l5.355 -4.531zm-13.2862 0.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h0.0001v-2.6488l5.7763 -5.7764v7.0111l-5.7764 5.2993zm12.7086 0.0248 -5.7766 -5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882 -5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z"
      />
    </svg>
  );
}

// ─── Gemini / Google AI Mode (same brand mark) ───────────────────
// The gradient IDs are prefixed so two instances on the same page can coexist.
export function GeminiLogo({ size = 24, className, title = 'Gemini' }: LogoProps) {
  return (
    <svg {...svgBase(size)} viewBox="0 0 65 65" fill="none" className={className} role="img" aria-label={title}>
      <title>{title}</title>
      <defs>
        <linearGradient id="gemini-gradient" x1="18.447" y1="43.42" x2="52.153" y2="15.004" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4893FC" />
          <stop offset=".27" stopColor="#4893FC" />
          <stop offset=".777" stopColor="#969DFF" />
          <stop offset="1" stopColor="#BD99FE" />
        </linearGradient>
      </defs>
      <path
        d="M32.447 0c.68 0 1.273.465 1.439 1.125a38.904 38.904 0 001.999 5.905c2.152 5 5.105 9.376 8.854 13.125 3.751 3.75 8.126 6.703 13.125 8.855a38.98 38.98 0 005.906 1.999c.66.166 1.124.758 1.124 1.438 0 .68-.464 1.273-1.125 1.439a38.902 38.902 0 00-5.905 1.999c-5 2.152-9.375 5.105-13.125 8.854-3.749 3.751-6.702 8.126-8.854 13.125a38.973 38.973 0 00-2 5.906 1.485 1.485 0 01-1.438 1.124c-.68 0-1.272-.464-1.438-1.125a38.913 38.913 0 00-2-5.905c-2.151-5-5.103-9.375-8.854-13.125-3.75-3.749-8.125-6.702-13.125-8.854a38.973 38.973 0 00-5.905-2A1.485 1.485 0 010 32.448c0-.68.465-1.272 1.125-1.438a38.903 38.903 0 005.905-2c5-2.151 9.376-5.104 13.125-8.854 3.75-3.749 6.703-8.125 8.855-13.125a38.972 38.972 0 001.999-5.905A1.485 1.485 0 0132.447 0z"
        fill="url(#gemini-gradient)"
      />
    </svg>
  );
}
export const GoogleAiModeLogo = GeminiLogo;

// ─── Dispatcher by model key ─────────────────────────────────────
// Maps the model keys stored in app_settings.modelsConfig → the right logo.
// When adding a new model, update MODEL_META, DEFAULT_MODELS_CONFIG, *and* this map.
const MODEL_TO_LOGO: Record<string, (p: LogoProps) => JSX.Element> = {
  chatgpt: OpenAiLogo,
  'openai-api': OpenAiLogo,
  'anthropic-api': ClaudeLogo,
  perplexity: PerplexityLogo,
  gemini: GeminiLogo,
  'google-aimode': GeminiLogo,
};

export interface ModelLogoProps extends LogoProps {
  model: string;
  /** Rendered when the model key has no logo registered. */
  fallback?: React.ReactNode;
}

export function ModelLogo({ model, fallback = null, ...rest }: ModelLogoProps) {
  const Logo = MODEL_TO_LOGO[model];
  if (!Logo) return <>{fallback}</>;
  return <Logo {...rest} />;
}
