import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The Vercel Web Analytics tag. It is a platform script served by the host, not a module this
// repo authors or ships, which is why the page rules that forbid external and inline scripts
// carve out this one src instead of dropping the rule.
export const VERCEL_INSIGHTS = '/_vercel/insights/script.js'

export const VERCEL_INSIGHTS_TAG = `<script defer src="${VERCEL_INSIGHTS}"></script>`

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/** Every page a visitor can land on: its path and the route file under web/routes/ that renders it. */
export const ROUTES = [
  { path: '/', file: 'web/routes/+page.svelte', legacy: 'atlas.html' },
  { path: '/como-ler', file: 'web/routes/como-ler/+page.svelte', legacy: 'como-ler.html' },
  { path: '/sobre', file: 'web/routes/sobre/+page.svelte', legacy: 'sobre.html' },
] as const

/** The shared shell every route is rendered into: head, stylesheet and the analytics tag. */
export const appTemplate = () => readFileSync(join(root, 'web', 'app.html'), 'utf8')

/** A route's `+page.svelte` source, by route path or by the name of the page it replaced. */
export const pageSource = (page: string) => {
  const route = ROUTES.find((r) => r.path === page || r.legacy === page)
  if (!route) throw new Error(`no route for ${page}`)
  return readFileSync(join(root, route.file), 'utf8')
}

/** The page's markup: its source without the component `<script>` block, which never reaches the DOM as written. */
const stripScript = (source: string) => source.replace(/<script\b[^>]*>[\s\S]*?<\/script>\s*/g, '')

/** A component the page mounts contributes its own markup, so a rule about the page reads what the browser gets. */
const expandComponents = (markup: string) =>
  markup.replace(/<([A-Z]\w*) \/>/g, (tag, name: string) => {
    const file = join(root, 'src', 'ui', `${name}.svelte`)
    return existsSync(file) ? stripScript(readFileSync(file, 'utf8')).replace(/<!--[\s\S]*?-->\s*/g, '').replace(/ class:[\w-]+=\{[^}]*\}/g, '').trim() : tag
  })

export const pageMarkup = (page: string) => expandComponents(stripScript(pageSource(page)))

/** Every `.svelte` file under web/. */
export const svelteFiles = (dir = join(root, 'web')): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? svelteFiles(join(dir, e.name)) : e.name.endsWith('.svelte') ? [join(dir, e.name)] : [],
  )

/** Every route file: none of them may carry the analytics tag, app.html carries it for all. */
export const ANALYTICS_PAGES = ROUTES.map((r) => r.file)

/** A site file by its old public/ name: a page reads its route's markup, anything else reads public/. */
export const siteFile = (name: string) =>
  ROUTES.some((r) => r.legacy === name) ? pageMarkup(name) : readFileSync(join(root, 'public', name), 'utf8')
