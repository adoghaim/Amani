/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        theme: {
          primary: '#C97C8B',
          'primary-dark': '#A85C6D',
          'primary-light': '#E8B4BD',
          'primary-faded': '#D4A8B0',
          accent: '#7A3E55',
          background: '#FFF8F7',
          'background-tint': '#fdf7f8',
          surface: '#FFFFFF',
          'surface-2': '#F6ECEB',
          'surface-hover': '#EED9D9',
          text: '#2A1F23',
          'text-body': '#4A3A40',
          'muted-text': '#6B5B60',
          'muted-text-2': '#7A6570',
          'muted-text-3': '#9A8A90',
          'muted-text-4': '#A8969C',
          'muted-text-5': '#c4adb2',
          border: '#E9D6DA',
          'border-subtle': '#e8dce0',
          'border-inner': '#f0e6ea',
          success: '#2F8F6B',
          warning: '#C78A2A',
          danger: '#B5475A',

          /*
            Warm neutral ramp. The app carried ~1,100 usages of Tailwind's
            `gray`, `slate` and `zinc` — all cool-biased — sitting on a warm
            rose ground, which is what made the UI read muddy. These are the
            same lightness steps tinted toward the rose, so they sit on the
            background instead of fighting it. Replace gray-N with neutral-N.
          */
          'neutral-50':  '#FBF7F7',
          'neutral-100': '#F4EEEE',
          'neutral-200': '#E7DDDF',
          'neutral-300': '#D5C7CA',
          'neutral-400': '#A8969C',
          'neutral-500': '#837177',
          'neutral-600': '#665459',
          'neutral-700': '#4A3A40',
          'neutral-800': '#332830',
          'neutral-900': '#2A1F23',

          /*
            Muted semantics. A flagged biomarker should inform, not alarm —
            someone reading a low ferritin is already anxious. These are the
            success/warning/danger hues desaturated and darkened to stay
            legible on the warm ground without shouting.
          */
          'flag-ok': '#2F8F6B',
          'flag-ok-bg': '#EAF4EF',
          'flag-ok-border': '#CBE4D8',
          'flag-watch': '#B07C25',
          'flag-watch-bg': '#FAF2E3',
          'flag-watch-border': '#EFDCB6',
          'flag-low': '#B5475A',
          'flag-low-bg': '#FBEDEF',
          'flag-low-border': '#F0CDD3',

          /* Informational, not a status. Kept distinct from the three flags so
             an explanatory callout never reads as a result being out of range. */
          'info': '#2E86B0',
          'info-bg': '#E8F1F6',
          'info-border': '#C4DDEA',

          /*
            Categorical hues for intervention types. NOT chosen by eye — run
            through the dataviz validator (OKLab lightness band, chroma floor,
            colour-vision-deficiency separation, contrast vs the #FFF8F7
            ground) until every check passed. Separation comes from lightness
            variation as much as hue: hue spacing alone failed protanopia.

            Fixed order, never cycled. `supplement` sits at 2.71:1 against the
            ground, which is legal only because these always render with a
            visible text label — do not use it as a bare colour chip.
          */
          'cat-medication': '#8E3A5E',
          'cat-supplement': '#D08A3A',
          'cat-diet': '#4E7A2E',
          'cat-exercise': '#2E86B0',
          'cat-sleep': '#5A4A9E',

          /*
            Cycle phases. The organising idea of the redesign: results are read
            against where someone is in their cycle, so phase needs to be a
            first-class token rather than an ad-hoc colour at each call site.
            Warm through the follicular rise, brightest at ovulation, deeper
            through the luteal fall.
          */
          'phase-menstrual': '#A85C6D',
          'phase-menstrual-bg': '#F7E7EA',
          'phase-follicular': '#C08A6B',
          'phase-follicular-bg': '#F9EEE6',
          'phase-ovulatory': '#C97C8B',
          'phase-ovulatory-bg': '#FBEEF0',
          'phase-luteal': '#7A3E55',
          'phase-luteal-bg': '#F4E6EA',
        },
      },
      fontFamily: {
        /* Fraunces carries the warmth; used for headings only, never body. */
        display: ['"Fraunces Variable"', 'Georgia', 'Cambria', 'serif'],
        /* Instrument Sans for everything read as interface. */
        sans: ['"Instrument Sans Variable"', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        /* Plex Mono for every measurement. Unambiguous 0/O and 1/l matter when
           the number is a test result. */
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        /*
          Shadows tinted with the ground's hue rather than neutral black, so
          elevation reads as part of the surface instead of dirt on top of it.
        */
        'theme-sm': '0 1px 2px rgba(42, 31, 35, 0.05)',
        'theme': '0 1px 2px rgba(42, 31, 35, 0.05), 0 4px 12px -6px rgba(42, 31, 35, 0.14)',
        'theme-lg': '0 1px 2px rgba(42, 31, 35, 0.05), 0 16px 40px -24px rgba(42, 31, 35, 0.34)',
      },
    },
  },
  plugins: [],
};
