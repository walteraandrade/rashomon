// The in-page guide (#helpDialog). Belongs to no figure: the header link and every figure's
// "como ler" point at como-ler.html, and this module intercepts those clicks so the reader
// never has to leave the graph. Modifier-click, middle-click, target=_blank and data-leave
// still go to the page, which is the shareable copy of the same text.

// Guarded: a test (or a page with no dialog) has no document to query.
const $ = (id: string): any => (typeof document === 'undefined' ? null : document.getElementById(id))

const HELP_SECTIONS = new Set(['analise', 'atlas', 'avaliacao', 'pmi', 'comparar', 'semana'])

export const closeHelp = () => {
  const dialog = $('helpDialog')
  if (dialog?.open) dialog.close()
}

export const openHelp = (hash = '') => {
  const dialog = $('helpDialog')
  if (!dialog) return
  if (!dialog.open) dialog.showModal?.()
  const section = hash.replace(/^#/, '')
  const target = section && HELP_SECTIONS.has(section) ? $(`help-${section}`) : null
  target?.scrollIntoView?.({ block: 'start' })
}

const helpHash = (href: string) => {
  const match = href.match(/(?:^|\/)como-ler\.html(?:#(.*))?$/)
  return match ? (match[1] ?? '') : null
}

const onClick = (event: MouseEvent) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const node = event.target as Element | null
  const link = node?.closest('a[href]')
  if (!link) return
  if (link.getAttribute('target') === '_blank' || link.hasAttribute('data-leave')) return
  const hash = helpHash(link.getAttribute('href') ?? '')
  if (hash === null) return
  event.preventDefault()
  openHelp(hash)
}

export const mountHelp = () => {
  const dialog = $('helpDialog')
  if (!dialog) return
  $('helpClose')?.addEventListener('click', () => closeHelp())
  dialog.addEventListener('click', (event: MouseEvent) => {
    if (event.target === dialog) closeHelp()
  })
  document.addEventListener('click', onClick)
}
