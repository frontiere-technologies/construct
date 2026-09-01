/**
 * Navigating between the translations grid and its form.
 *
 * The grid keeps sort and every column filter in its query string. The panel
 * this form replaced never left the list, so that state was never lost; a page
 * that came back to a bare list would be a regression for anyone working
 * through many keys. So the query travels along, in a `from` parameter.
 *
 * `from` holds a **query string only** — never a path, never an absolute URL.
 * The destination below is a module constant, so an open redirect is impossible
 * by construction instead of by validation: a hostile `from` can at worst
 * become a meaningless query parameter on the translations list itself. That is
 * why nothing here inspects or rejects the value.
 */
export const TRANSLATIONS_LIST_PATH = '/admin/translations'

/** The list URL to return to. Anything unusable yields the unfiltered list. */
export function translationsListHref(from: string | null | undefined): string {
  // URLSearchParams strips a single leading '?' itself, and re-encodes whatever
  // it parsed — so a filter value containing slashes or a colon survives.
  const query = new URLSearchParams(from ?? '').toString()
  return query ? `${TRANSLATIONS_LIST_PATH}?${query}` : TRANSLATIONS_LIST_PATH
}

function withFrom(path: string, listSearch: string): string {
  const from = new URLSearchParams(listSearch).toString()
  return from ? `${path}?${new URLSearchParams({ from }).toString()}` : path
}

export function translationEditHref(keyId: number, listSearch: string): string {
  return withFrom(`${TRANSLATIONS_LIST_PATH}/${keyId}/edit`, listSearch)
}

export function translationCreateHref(listSearch: string): string {
  return withFrom(`${TRANSLATIONS_LIST_PATH}/create`, listSearch)
}
