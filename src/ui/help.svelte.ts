// The in-page guide's imperative surface (#helpDialog). The component (HelpDialog.svelte) owns
// the dialog element and the document click listener; these functions stay plain and importable.

export const HELP_SECTIONS = new Set(['analise', 'atlas', 'avaliacao', 'pmi', 'comparar', 'em-alta', 'semana', 'lentes', 'atencao', 'agenda', 'junto', 'persistencia'])

let mounted: HTMLDialogElement | null = null
// The mounted component's element, or the page's own #helpDialog when none is mounted; guarded
// because a test (or a page with no dialog) has no document to query.
const find = (): any => mounted ?? (typeof document === 'undefined' ? null : document.getElementById('helpDialog'))

export const attachHelp = (el: HTMLDialogElement | null) => {
  mounted = el
}

export const closeHelp = () => {
  const dialog = find()
  if (dialog?.open) dialog.close()
}

export const openHelp = (hash = '') => {
  const dialog = find()
  if (!dialog) return
  if (!dialog.open) dialog.showModal?.()
  const section = hash.replace(/^#/, '')
  const target = section && HELP_SECTIONS.has(section) ? document.getElementById(`help-${section}`) : null
  target?.scrollIntoView?.({ block: 'start' })
}

export const helpHash = (href: string) => {
  const match = href.match(/(?:^|\/)como-ler(?:\.html)?(?:#(.*))?$/)
  return match ? (match[1] ?? '') : null
}

export const onGuideClick = (event: MouseEvent) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const link = (event.target as Element | null)?.closest('a[href]')
  if (!link) return
  if (link.getAttribute('target') === '_blank' || link.hasAttribute('data-leave')) return
  const hash = helpHash(link.getAttribute('href') ?? '')
  if (hash === null) return
  event.preventDefault()
  openHelp(hash)
}

// Kept for app.ts: the component owns every listener, so there is nothing to attach.
export const mountHelp = () => {}
