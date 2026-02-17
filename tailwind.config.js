/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: 'class',
    content: ["./frontend/**/*.{html,js}"],
    theme: {
        extend: {
            colors: {
                // Semantic System
                "bg-main": "var(--color-bg-main)",
                "bg-secondary": "var(--color-bg-secondary)",
                "bg-tertiary": "var(--color-bg-tertiary)",
                "bg-hover": "var(--color-bg-hover)",
                "bg-disabled": "var(--color-bg-disabled)",
                "surface-0": "var(--color-surface-0)",
                "surface-1": "var(--color-surface-1)",
                "surface-2": "var(--color-surface-2)",
                "surface-panel": "var(--color-surface-panel)",
                "surface-chip": "var(--color-surface-chip)",
                "border": "var(--color-border)",
                "border-subtle": "var(--color-border-subtle)",
                "border-normal": "var(--color-border-normal)",
                "border-strong": "var(--color-border-strong)",
                "text-main": "var(--color-text-main)",
                "text-secondary": "var(--color-text-secondary)",
                "text-muted": "var(--color-text-muted)",
                "text-disabled": "var(--color-text-disabled)",
                "text-contrast": "var(--color-text-contrast)",
                "text-chip": "var(--color-text-chip)",
                "text-on-dark": "var(--color-text-on-dark)",
                "primary": "var(--color-primary)",
                "primary-light": "var(--color-primary-light)",
                "primary-lighter": "var(--color-primary-lighter)",
                "primary-dark": "var(--color-primary-dark)",
                "primary-darker": "var(--color-primary-darker)",
                "primary-fg": "var(--color-primary-fg)",
                "primary-contrast": "var(--color-primary-contrast)",
                "primary-hover": "var(--color-primary-hover)", // Keep legacy or map to calc if needed, but keeping for compatibility
                "accent": "var(--color-accent)",
                "status-error": "var(--color-status-error)",

                "error": "var(--color-error)",
                "error-light": "var(--color-error-light)",
                "error-lighter": "var(--color-error-lighter)",
                "error-dark": "var(--color-error-dark)",
                "error-darker": "var(--color-error-darker)",
                "error-text": "var(--color-error-text)",

                // Expanded Semantic Palette
                "secondary": "var(--color-secondary)",
                "secondary-light": "var(--color-secondary-light)",
                "secondary-lighter": "var(--color-secondary-lighter)",
                "secondary-dark": "var(--color-secondary-dark)",
                "secondary-darker": "var(--color-secondary-darker)",

                "accent": "var(--color-accent)",
                "accent-light": "var(--color-accent-light)",
                "accent-lighter": "var(--color-accent-lighter)",
                "accent-dark": "var(--color-accent-dark)",
                "accent-darker": "var(--color-accent-darker)",

                "success": "var(--color-success)",
                "success-light": "var(--color-success-light)",
                "success-lighter": "var(--color-success-lighter)",
                "success-dark": "var(--color-success-dark)",
                "success-darker": "var(--color-success-darker)",
                "success-text": "var(--color-success-text)",

                "warning": "var(--color-warning)",
                "warning-light": "var(--color-warning-light)",
                "warning-lighter": "var(--color-warning-lighter)",
                "warning-dark": "var(--color-warning-dark)",
                "warning-darker": "var(--color-warning-darker)",

                "info": "var(--color-info)",
                "info-light": "var(--color-info-light)",
                "info-lighter": "var(--color-info-lighter)",
                "info-dark": "var(--color-info-dark)",
                "info-darker": "var(--color-info-darker)",
                "info-text": "var(--color-info-text)",

                // Legacy compatibility mappings (can be deprecated later)
                "background": "var(--color-bg-main)",
                "surface": "var(--color-surface-1)",
                "background-light": "var(--color-bg-secondary)",
                "background-dark": "var(--color-bg-main)",
                "card-light": "var(--color-surface-1)",
                "primary-accent": "var(--color-primary)",
                "primary-text": "var(--color-primary)",
                "secondary-accent": "var(--color-secondary)",
                "secondary-text": "var(--color-secondary-text)",
                "warning-bg": "var(--color-warning-light)",
                "warning-text": "var(--color-warning-text)",
                "missed-bg": "var(--color-warning-lighter)",
                "text-dark": "var(--color-text-main)",
                "text-light-secondary": "var(--color-text-secondary)",
                "border-light": "var(--color-border-subtle)",
                "hover-light": "var(--color-bg-hover)",
                "heat-low": "var(--color-primary-lighter)",
                "heat-med": "var(--color-primary-light)",
                "heat-high": "var(--color-primary)",
                "heat-active": "var(--color-primary-dark)",
                "heat-missed": "var(--color-warning-light)",

                // Overlays / scrims / ink surfaces
                "bg-ink": "var(--color-bg-ink)",
                "scrim-faint": "var(--color-scrim-faint)",
                "scrim-light": "var(--color-scrim-light)",
                "scrim-weak": "var(--color-scrim-weak)",
                "scrim": "var(--color-scrim)",
                "scrim-strong": "var(--color-scrim-strong)",
                "scrim-heavy": "var(--color-scrim-heavy)",
                "scrim-intense": "var(--color-scrim-intense)",

                // Glass overlays (light, for use on dark scrims)
                "glass-light": "var(--color-glass-light)",
                "glass-strong": "var(--color-glass-strong)",
            },
            fontFamily: {
                "display": ["Space Grotesk", "Inter", "sans-serif"],
                "body": ["Noto Sans", "Inter", "sans-serif"]
            },
            borderRadius: { "DEFAULT": "0.25rem", "lg": "0.5rem", "xl": "0.75rem", "2xl": "1rem", "full": "9999px" },
            animation: {
                'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
            },
            keyframes: {
                'pulse-soft': {
                    '0%, 100%': { opacity: '1', transform: 'scale(1)' },
                    '50%': { opacity: '0.8', transform: 'scale(1.05)' },
                },
            },
        },
    },
    safelist: [
        // Pattern-based safelist to force generation of all semantic color families
        // This defeats the implicit build failure we observed with string-based safelists.
        {
            pattern: /bg-(secondary|primary|success|warning|info|accent)(-(light|lighter|dark|darker))?/,
            variants: ['hover', 'focus', 'active']
        },
        {
            pattern: /border-(secondary|primary|success|warning|info|accent)(-(light|lighter|dark|darker))?/,
            variants: ['hover', 'focus']
        },
        {
            pattern: /text-(secondary|primary|success|warning|info|accent)(-(light|lighter|dark|darker))?/,
            variants: ['hover', 'focus']
        },
        {
            pattern: /ring-(secondary|primary|success|warning|info|accent)(-(light|lighter|dark|darker))?/,
            variants: ['focus']
        },
        // Explicit disabled variants used by S1 controls.
        'disabled:bg-primary',
        'disabled:bg-primary-light',
        'disabled:text-primary-fg',
        // Legacy/Specific overrides
        { pattern: /^text-white$/ },
        { pattern: /^bg-white$/ },

        // Keep stats colors if needed
        'bg-blue-50', 'dark:bg-blue-900/20', 'text-blue-600',
        'bg-purple-50', 'dark:bg-purple-900/20', 'text-purple-600',
        'bg-amber-50', 'dark:bg-amber-900/20', 'text-amber-600',
        'bg-indigo-500', 'bg-cyan-500', 'bg-rose-500', 'bg-emerald-500', 'bg-slate-500'
    ],
    plugins: [
        require('@tailwindcss/forms'),
        require('@tailwindcss/container-queries'),
    ],
}
