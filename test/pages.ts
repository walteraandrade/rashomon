// The Vercel Web Analytics tag. It is a platform script served by the host, not a module this
// repo authors or ships, which is why the page rules that forbid external and inline scripts
// carve out this one src instead of dropping the rule.
export const VERCEL_INSIGHTS = '/_vercel/insights/script.js'

export const VERCEL_INSIGHTS_TAG = `<script defer src="${VERCEL_INSIGHTS}"></script>`

/** Every page a visitor can land on, and therefore every page the analytics tag belongs on. */
export const ANALYTICS_PAGES = ['design-5.html', 'como-ler.html', 'compare.html']
