/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            screens: {
                'xs': '480px',
            },
            colors: {
                'theme-main': 'var(--text-primary)',
                'theme-muted': 'var(--text-secondary)',
                'theme-accent': 'var(--accent-primary)',
            }
        },
    },
    plugins: [],
}
