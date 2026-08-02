export function resolveSidebarPresentation(
  isNarrowViewport: boolean,
  masterCollapsed: boolean,
  persistedColumnCollapsed: boolean,
) {
  return {
    masterCollapsed,
    columnCollapsed: isNarrowViewport || persistedColumnCollapsed,
    showColumnToggle: !isNarrowViewport,
  }
}
