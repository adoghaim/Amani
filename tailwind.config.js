/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        theme: {
          /*
            THE AMANI BRAND PALETTE — midnight navy, lunar mauve, warm ivory.

            Every value below was derived in OKLCH and solved to a contrast
            target, not picked by eye. Re-run tools/contrast/validate.mjs after
            any change; it fails the build if a token used as text drops below
            4.5:1 against the surface it actually sits on.
          */
          primary: '#95617C',            /* lunar mauve, the brand anchor */
          'primary-dark': '#7A4963',       /* hover / pressed */
          'primary-light': '#E1C1D0',      /* tints and fills */
          'primary-faded': '#AD8197',      /* secondary / disabled */
          accent: '#0D2033',             /* midnight navy */

          background: '#FBF7F5',         /* warm ivory, the ground */
          'background-tint': '#F5F0F3',
          surface: '#FFFCFB',            /* cards sit ABOVE the ground, not below */
          'surface-2': '#EDE5EB',
          'surface-hover': '#E7D8E2',

          /*
            Text ramp: navy at the dark end, drifting toward the mauve as it
            lightens, so faint text still reads as part of the brand rather
            than as grey. Usage audit showed ALL of these land on text-xs /
            text-sm body copy, so every step clears 4.5:1 — 15.5, 10, 7.0,
            5.6, 4.6 against the ground.

            The old -4 (2.67:1) and -5 (2.01:1) steps were illegible and have
            been folded into -3. That is a reduction in levels, not a
            flattening: the five remaining steps stay perceptually distinct.
          */
          text: '#0D2033',
          'text-body': '#323F54',
          'muted-text': '#4D5569',
          'muted-text-2': '#606377',
          'muted-text-3': '#716F82',

          border: '#D2C6CF',
          'border-subtle': '#E3DBE0',
          'border-inner': '#EDE8EB',

          success: '#197F5C',
          warning: '#986600',
          danger: '#B94A5D',
          'warning-dark': '#7F4E00',
          'danger-dark': '#9E3247',

          /*
            Neutral ramp, re-tinted from the old rose (hue ~340) onto the
            brand's navy/mauve axis. It carries two roles and the split is
            deliberate: 50-300 are surfaces and borders, 400-900 are text.
            Only the text half needs AA, and the text half is exactly where it
            failed before — neutral-400 had 78 text usages at 2.63:1 and
            neutral-500 had 49 at 4.29:1.
          */
          'neutral-50': '#F6F3F6',
          'neutral-100': '#EEE8ED',
          'neutral-200': '#DAD3D8',
          'neutral-300': '#BBB1B9',
          'neutral-400': '#736F7C',
          'neutral-500': '#626071',
          'neutral-600': '#4E4F63',
          'neutral-700': '#333B4E',
          'neutral-800': '#202E42',
          'neutral-900': '#0D2033',

          /*
            Flag states. Each foreground is solved against its OWN tinted
            background, which is where they are actually rendered — the
            previous set passed against the page ground and failed on the
            tint (flag-ok 3.55, flag-watch 3.28, info 3.56).
          */
          'flag-ok': '#077754',
          'flag-ok-bg': '#E4EEE9',
          'flag-ok-border': '#BCD6C9',
          'flag-watch': '#905D00',
          'flag-watch-bg': '#F3EBE1',
          'flag-watch-border': '#DFCDB6',
          'flag-low': '#B04356',
          'flag-low-bg': '#F9E8EA',
          'flag-low-border': '#EFC6CA',

          /* Informational, not a status — kept distinct from the three flags. */
          'info': '#097099',
          'info-bg': '#E3EDF4',
          'info-border': '#BBD3E2',

          /*
            Categorical hues for intervention types. Rendered as the LABEL TEXT
            in LabsTimeline, not as bare chips, so 4.5:1 applies to all five —
            the previous note claiming 2.71:1 was acceptable was wrong.

            Chosen by search, not by eye: hue held within 15 deg of its
            semantic (green still means diet) while the five contrast targets
            are spread so the set separates by LIGHTNESS as well as hue. Hue
            spacing alone collapses under protanopia. Worst-case OKLab dE
            across normal/protan/deutan/tritan vision is 0.090. That is
            slightly under the 0.10 comfort threshold, which is acceptable
            here only because the chip always spells out the category name —
            colour is redundant encoding (WCAG 1.4.1), never the sole cue.
            Do not reuse these as bare colour swatches.
          */
          'cat-medication': '#943E5D',
          'cat-supplement': '#643E00',
          'cat-diet': '#5F6E08',
          'cat-exercise': '#10779F',
          'cat-sleep': '#4F4498',

          /*
            Cycle phases, re-derived onto the brand axis (they were all rose
            before, hue 337-348). The narrative survives the move: lightest at
            ovulation, deepest through the luteal fall toward the navy. All
            four are used as text, so all four clear AA.
          */
          'phase-menstrual': '#8D435E',
          'phase-menstrual-bg': '#F5E8EB',
          'phase-follicular': '#945843',
          'phase-follicular-bg': '#F3E9E6',
          'phase-ovulatory': '#955276',
          'phase-ovulatory-bg': '#F4E8ED',
          'phase-luteal': '#414379',
          'phase-luteal-bg': '#E9EAF4',
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
          Shadows tinted with the ground's ink rather than neutral black, so
          elevation reads as part of the surface instead of dirt on top of it.
        */
        'theme-sm': '0 1px 2px rgba(13, 32, 51, 0.05)',
        'theme': '0 1px 2px rgba(13, 32, 51, 0.05), 0 4px 12px -6px rgba(13, 32, 51, 0.14)',
        'theme-lg': '0 1px 2px rgba(13, 32, 51, 0.05), 0 16px 40px -24px rgba(13, 32, 51, 0.34)',
      },
    },
  },
  plugins: [],
};
