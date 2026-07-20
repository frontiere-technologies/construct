# Sidebar Responsive Auto-Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Below a 768px viewport width, force all three sidebar columns (col1/col2/col3) into icon-only mode so the layout never breaks the way it does today when a text-mode column is squeezed by a narrow browser window, without ever touching the user's saved per-column preference or the independent full-collapse (`masterCollapsed`) control.

**Architecture:** A single new `isNarrowViewport` boolean state in `components/Sidebar.tsx`, driven by a `matchMedia('(max-width: 767px)')` listener. Three purely computed values (`effCol1Collapsed`, `effCol2Collapsed`, `effCol3Collapsed` — each `isNarrowViewport || colXCollapsed`) replace the raw `colXCollapsed` state at every *rendering* call site (widths, `isCollapsed` props, tooltip triggers). The raw state, its setters, and its localStorage persistence are untouched. `ColToggle` gains an optional `disabled` prop so the chevron button disappears below the breakpoint instead of sitting inert.

**Tech Stack:** React 19 / TypeScript, Tailwind CSS v4, `clsx`, Python/Playwright e2e tests (`uv run pytest`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-20-sidebar-responsive-collapse-design.md`
- Breakpoint is exactly 768px (`matchMedia('(max-width: 767px)')`) — matches Tailwind's `md` breakpoint.
- All three columns (col1, col2, col3) are forced to icon-only below the breakpoint, not just col1.
- The forced icon state is never written to `localStorage` / `sidebarCollapseState` — it is a pure render-time override on top of the existing persisted `col1Collapsed`/`col2Collapsed`/`col3Collapsed` state.
- Below the breakpoint, each column's `sidebar-toggle` chevron button does not render at all (not just visually disabled).
- `masterCollapsed` and the collapsed-rail behavior are completely unaffected by viewport width.
- No new `data-testid` values, no new localStorage keys.

---

### Task 1: Force icon-only mode below 768px in `Sidebar.tsx`

**Files:**
- Modify: `sources/microservices/web-construct/components/Sidebar.tsx`
- Test: `sources/tests/e2e/test_sidebar.py`

**Interfaces:**
- Consumes: existing `col1Collapsed`/`col2Collapsed`/`col3Collapsed` state and setters, existing `ColToggle` component, existing `userPanelItemCls` — all defined earlier in the same file (no changes to their persistence behavior).
- Produces: new `isNarrowViewport: boolean` state (default `false`), new `effCol1Collapsed`/`effCol2Collapsed`/`effCol3Collapsed` derived constants, new optional `disabled?: boolean` prop on `ColToggle`. None of these are consumed outside this file.

This is a single task because the viewport listener, the derived constants, and every one of their render-site usages only make sense — and can only be verified — together; there is no meaningful intermediate state a reviewer could approve independently (a partial rewrite would leave some columns responsive and others not, which is strictly worse than the current behavior).

- [ ] **Step 1: Write the failing e2e tests**

Open `sources/tests/e2e/test_sidebar.py` and append these two tests at the end of the file (the file already imports `ensure_l1_expanded` and `ensure_l2_open` at the top, so no new imports are needed):

```python
def test_narrow_viewport_forces_col1_icons(logged_in_page):
    page = logged_in_page
    l1 = page.locator("aside").first
    ensure_l1_expanded(page, l1)
    assert l1.bounding_box()["width"] >= 100, "L1 was not in text mode before narrowing"

    page.set_viewport_size({"width": 600, "height": 900})
    page.wait_for_function(
        "() => document.querySelector('aside').getBoundingClientRect().width < 100",
        timeout=5_000,
    )
    assert l1.bounding_box()["width"] < 100, "L1 did not force icon mode below 768px"
    assert l1.locator('[data-testid="sidebar-toggle"]').count() == 0, "Toggle should not render below 768px"

    page.set_viewport_size({"width": 1440, "height": 900})
    page.wait_for_function(
        "() => document.querySelector('aside').getBoundingClientRect().width >= 100",
        timeout=5_000,
    )
    assert l1.bounding_box()["width"] >= 100, "L1 did not restore saved (text) preference above 768px"
    assert l1.locator('[data-testid="sidebar-toggle"]').is_visible()


def test_narrow_viewport_forces_col2_icons(logged_in_page):
    page = logged_in_page
    ensure_l2_open(page)
    l2 = page.locator("aside").nth(1)
    assert l2.bounding_box()["width"] >= 100, "L2 was not in text mode before narrowing"

    page.set_viewport_size({"width": 600, "height": 900})
    page.wait_for_function(
        "() => document.querySelectorAll('aside')[1].getBoundingClientRect().width < 100",
        timeout=5_000,
    )
    assert l2.bounding_box()["width"] < 100, "L2 did not force icon mode below 768px"

    page.set_viewport_size({"width": 1440, "height": 900})
    page.wait_for_function(
        "() => document.querySelectorAll('aside')[1].getBoundingClientRect().width >= 100",
        timeout=5_000,
    )
    assert l2.bounding_box()["width"] >= 100, "L2 did not restore saved (text) preference above 768px"
```

- [ ] **Step 2: Start the dev server and run the tests to verify they fail**

In one terminal, from `sources/microservices/web-construct/`:
```bash
npm run dev
```

In another terminal, from the repo root:
```bash
uv run pytest sources/tests/e2e/test_sidebar.py -k narrow_viewport -v
```

Expected: both FAIL — `page.wait_for_function` times out because the sidebar never shrinks below 100px regardless of viewport width (`TimeoutError: page.wait_for_function: Timeout ... waiting for function`).

- [ ] **Step 3: Add a `disabled` prop to `ColToggle`**

Find:
```typescript
const ColToggle: React.FC<{ collapsed: boolean; onToggle: () => void }> = ({ collapsed, onToggle }) => (
  <button
    data-testid="sidebar-toggle"
    onClick={onToggle}
    className="absolute -right-3 bottom-4 bg-sidebar-bg border border-sidebar-text/10 rounded-full p-1 shadow-sm hover:bg-sidebar-active-bg z-10"
  >
    {collapsed
      ? <ChevronRight size={14} className="text-sidebar-text/60" />
      : <ChevronLeft size={14} className="text-sidebar-text/60" />}
  </button>
)
```

Replace with:
```typescript
const ColToggle: React.FC<{ collapsed: boolean; onToggle: () => void; disabled?: boolean }> = ({ collapsed, onToggle, disabled }) => {
  if (disabled) return null
  return (
    <button
      data-testid="sidebar-toggle"
      onClick={onToggle}
      className="absolute -right-3 bottom-4 bg-sidebar-bg border border-sidebar-text/10 rounded-full p-1 shadow-sm hover:bg-sidebar-active-bg z-10"
    >
      {collapsed
        ? <ChevronRight size={14} className="text-sidebar-text/60" />
        : <ChevronLeft size={14} className="text-sidebar-text/60" />}
    </button>
  )
}
```

- [ ] **Step 4: Add the `isNarrowViewport` state and the three derived `eff*Collapsed` constants**

Find:
```typescript
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify({ col1: col1Collapsed, col2: col2Collapsed, col3: col3Collapsed, master: masterCollapsed }))
    } catch { /* ignore quota errors */ }
  }, [col1Collapsed, col2Collapsed, col3Collapsed, masterCollapsed])

  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
```

Replace with:
```typescript
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify({ col1: col1Collapsed, col2: col2Collapsed, col3: col3Collapsed, master: masterCollapsed }))
    } catch { /* ignore quota errors */ }
  }, [col1Collapsed, col2Collapsed, col3Collapsed, masterCollapsed])

  // Below this viewport width, force all three columns to icon-only mode so the
  // fixed-width text columns never squeeze the layout. This never touches the
  // persisted col1/col2/col3 preference — it's a pure render-time override.
  const [isNarrowViewport, setIsNarrowViewport] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    setIsNarrowViewport(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsNarrowViewport(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const effCol1Collapsed = isNarrowViewport || col1Collapsed
  const effCol2Collapsed = isNarrowViewport || col2Collapsed
  const effCol3Collapsed = isNarrowViewport || col3Collapsed

  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
```

- [ ] **Step 5: Use `effCol2Collapsed` in `userPanelItemCls`**

Find:
```typescript
  const userPanelItemCls = clsx(
    'w-full flex items-center rounded-lg py-2 px-3 transition-colors duration-200 text-sm',
    col2Collapsed ? 'justify-center' : 'gap-3',
    'text-sidebar-text hover:bg-sidebar-active-bg/50 hover:text-sidebar-active-text'
  )
```

Replace with:
```typescript
  const userPanelItemCls = clsx(
    'w-full flex items-center rounded-lg py-2 px-3 transition-colors duration-200 text-sm',
    effCol2Collapsed ? 'justify-center' : 'gap-3',
    'text-sidebar-text hover:bg-sidebar-active-bg/50 hover:text-sidebar-active-text'
  )
```

- [ ] **Step 6: Col1 `aside` width, `ColToggle`, and the master-collapse button**

Find:
```typescript
      <aside className={clsx(
        'h-screen bg-sidebar-bg text-sidebar-text border-r border-sidebar-text/10 flex flex-col flex-shrink-0 relative transition-all duration-300',
        col1Collapsed ? ICON_COL_W : TEXT_COL_W
      )}>
        <ColToggle collapsed={col1Collapsed} onToggle={() => setCol1Collapsed(c => !c)} />

        <div className="p-2 border-b border-sidebar-text/10">
          <button
            data-testid="sidebar-master-toggle"
            onClick={() => setMasterCollapsed(true)}
            title="Collassa menu"
            className={clsx(
              'w-full flex items-center rounded-lg py-2 px-3 text-sidebar-text hover:bg-sidebar-active-bg/50 hover:text-sidebar-active-text transition-colors duration-200',
              col1Collapsed ? 'justify-center' : 'gap-3'
            )}
          >
            <PanelLeftClose size={20} className="flex-shrink-0" />
            {!col1Collapsed && <span className="text-sm">Collassa menu</span>}
          </button>
        </div>
```

Replace with:
```typescript
      <aside className={clsx(
        'h-screen bg-sidebar-bg text-sidebar-text border-r border-sidebar-text/10 flex flex-col flex-shrink-0 relative transition-all duration-300',
        effCol1Collapsed ? ICON_COL_W : TEXT_COL_W
      )}>
        <ColToggle collapsed={effCol1Collapsed} onToggle={() => setCol1Collapsed(c => !c)} disabled={isNarrowViewport} />

        <div className="p-2 border-b border-sidebar-text/10">
          <button
            data-testid="sidebar-master-toggle"
            onClick={() => setMasterCollapsed(true)}
            title="Collassa menu"
            className={clsx(
              'w-full flex items-center rounded-lg py-2 px-3 text-sidebar-text hover:bg-sidebar-active-bg/50 hover:text-sidebar-active-text transition-colors duration-200',
              effCol1Collapsed ? 'justify-center' : 'gap-3'
            )}
          >
            <PanelLeftClose size={20} className="flex-shrink-0" />
            {!effCol1Collapsed && <span className="text-sm">Collassa menu</span>}
          </button>
        </div>
```

- [ ] **Step 7: Top and main L1 item lists use `effCol1Collapsed`**

Find:
```typescript
        {topItems.length > 0 && (
          <div className="p-2 border-b border-sidebar-text/10 space-y-1">
            {topItems.map(item => (
              <L1Item key={item.id} item={item} isSelected={selectedL1Id === item.id}
                isActive={item.type === 'container' ? activeL1Id === item.id : item.id === activeRouteId}
                isCollapsed={col1Collapsed} hasChildren={itemsWithChildren.has(item.id)}
                onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
                onClick={() => handleL1Click(item)} />
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1 scrollbar-hide">
          {mainItems.map(item => (
            <L1Item key={item.id} item={item} isSelected={selectedL1Id === item.id}
              isActive={item.type === 'container' ? activeL1Id === item.id : item.id === activeRouteId}
              isCollapsed={col1Collapsed} hasChildren={itemsWithChildren.has(item.id)}
              onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
              onClick={() => handleL1Click(item)} />
          ))}
        </div>
```

Replace with:
```typescript
        {topItems.length > 0 && (
          <div className="p-2 border-b border-sidebar-text/10 space-y-1">
            {topItems.map(item => (
              <L1Item key={item.id} item={item} isSelected={selectedL1Id === item.id}
                isActive={item.type === 'container' ? activeL1Id === item.id : item.id === activeRouteId}
                isCollapsed={effCol1Collapsed} hasChildren={itemsWithChildren.has(item.id)}
                onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
                onClick={() => handleL1Click(item)} />
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1 scrollbar-hide">
          {mainItems.map(item => (
            <L1Item key={item.id} item={item} isSelected={selectedL1Id === item.id}
              isActive={item.type === 'container' ? activeL1Id === item.id : item.id === activeRouteId}
              isCollapsed={effCol1Collapsed} hasChildren={itemsWithChildren.has(item.id)}
              onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
              onClick={() => handleL1Click(item)} />
          ))}
        </div>
```

- [ ] **Step 8: Bottom L1 item list and the user account button use `effCol1Collapsed`**

Find:
```typescript
        <div className="p-2 border-t border-sidebar-text/10 space-y-1">
          {bottomItems.map(item => (
            <L1Item key={item.id} item={item} isSelected={selectedL1Id === item.id}
              isActive={item.type === 'container' ? activeL1Id === item.id : item.id === activeRouteId}
              isCollapsed={col1Collapsed} hasChildren={itemsWithChildren.has(item.id)}
              onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
              onClick={() => handleL1Click(item)} />
          ))}

          {/* User section — clickable, opens user panel in col2 */}
          <button
            onClick={handleUserClick}
            onMouseEnter={col1Collapsed ? e => showTooltip(e, authUser?.email?.split('@')[0] ?? 'Account') : undefined}
            onMouseLeave={col1Collapsed ? hideTooltip : undefined}
            className={clsx(
              'w-full flex items-center gap-2 rounded-lg py-2 px-2 mt-1 border-t border-sidebar-text/10 pt-3 transition-colors duration-200',
              col1Collapsed ? 'justify-center' : '',
              userPanelOpen
                ? 'text-sidebar-active-text'
                : 'text-sidebar-text hover:text-sidebar-active-text'
            )}
          >
            {authUser?.image
              ? <Image src={authUser.image} alt="" width={26} height={26} className="rounded-full flex-shrink-0" />
              : <CircleUser size={26} className={clsx('flex-shrink-0 transition-colors', userPanelOpen ? 'text-primary' : 'opacity-60')} />
            }
            {!col1Collapsed && (
              <div className="flex flex-col min-w-0 flex-1 text-left">
                <TruncatedSpan text={authUser?.email?.split('@')[0] ?? ''} className="text-xs font-medium truncate" onShowTooltip={showTooltip} onHideTooltip={hideTooltip} />
                <TruncatedSpan text={authUser?.email ?? ''} className="text-xs opacity-50 truncate" onShowTooltip={showTooltip} onHideTooltip={hideTooltip} />
              </div>
            )}
          </button>
        </div>
```

Replace with:
```typescript
        <div className="p-2 border-t border-sidebar-text/10 space-y-1">
          {bottomItems.map(item => (
            <L1Item key={item.id} item={item} isSelected={selectedL1Id === item.id}
              isActive={item.type === 'container' ? activeL1Id === item.id : item.id === activeRouteId}
              isCollapsed={effCol1Collapsed} hasChildren={itemsWithChildren.has(item.id)}
              onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
              onClick={() => handleL1Click(item)} />
          ))}

          {/* User section — clickable, opens user panel in col2 */}
          <button
            onClick={handleUserClick}
            onMouseEnter={effCol1Collapsed ? e => showTooltip(e, authUser?.email?.split('@')[0] ?? 'Account') : undefined}
            onMouseLeave={effCol1Collapsed ? hideTooltip : undefined}
            className={clsx(
              'w-full flex items-center gap-2 rounded-lg py-2 px-2 mt-1 border-t border-sidebar-text/10 pt-3 transition-colors duration-200',
              effCol1Collapsed ? 'justify-center' : '',
              userPanelOpen
                ? 'text-sidebar-active-text'
                : 'text-sidebar-text hover:text-sidebar-active-text'
            )}
          >
            {authUser?.image
              ? <Image src={authUser.image} alt="" width={26} height={26} className="rounded-full flex-shrink-0" />
              : <CircleUser size={26} className={clsx('flex-shrink-0 transition-colors', userPanelOpen ? 'text-primary' : 'opacity-60')} />
            }
            {!effCol1Collapsed && (
              <div className="flex flex-col min-w-0 flex-1 text-left">
                <TruncatedSpan text={authUser?.email?.split('@')[0] ?? ''} className="text-xs font-medium truncate" onShowTooltip={showTooltip} onHideTooltip={hideTooltip} />
                <TruncatedSpan text={authUser?.email ?? ''} className="text-xs opacity-50 truncate" onShowTooltip={showTooltip} onHideTooltip={hideTooltip} />
              </div>
            )}
          </button>
        </div>
```

- [ ] **Step 9: Col2 `aside` width, `ColToggle`, and header use `effCol2Collapsed`**

Find:
```typescript
      {showCol2 && (
        <aside className={clsx(
          'h-screen bg-sidebar-bg text-sidebar-text border-r border-sidebar-text/10 flex flex-col flex-shrink-0 relative transition-all duration-300',
          col2Collapsed ? ICON_SUB_W : TEXT_SUB_W
        )}>
          <ColToggle collapsed={col2Collapsed} onToggle={() => setCol2Collapsed(c => !c)} />
          {!col2Collapsed && (
```

Replace with:
```typescript
      {showCol2 && (
        <aside className={clsx(
          'h-screen bg-sidebar-bg text-sidebar-text border-r border-sidebar-text/10 flex flex-col flex-shrink-0 relative transition-all duration-300',
          effCol2Collapsed ? ICON_SUB_W : TEXT_SUB_W
        )}>
          <ColToggle collapsed={effCol2Collapsed} onToggle={() => setCol2Collapsed(c => !c)} disabled={isNarrowViewport} />
          {!effCol2Collapsed && (
```

- [ ] **Step 10: Profile link, Theme Mode toggle, and the L1-children subitem list use `effCol2Collapsed`**

Find:
```typescript
                <Link
                  href="/profile"
                  onMouseEnter={col2Collapsed ? e => showTooltip(e, 'Profile') : undefined}
                  onMouseLeave={col2Collapsed ? hideTooltip : undefined}
                  className={clsx(
                    userPanelItemCls,
                    pathname === '/profile' ? 'bg-sidebar-active-bg text-sidebar-active-text font-medium ring-1 ring-inset ring-primary/70' : ''
                  )}
                >
                  <User size={16} className={pathname === '/profile' ? 'text-primary' : ''} />
                  {!col2Collapsed && <span>Profile</span>}
                </Link>

                {/* Theme Mode */}
                {col2Collapsed ? (
                  <button
                    onClick={toggleTheme}
                    onMouseEnter={e => showTooltip(e, settings.theme === 'light' ? 'Switch to Dark' : 'Switch to Light')}
                    onMouseLeave={hideTooltip}
                    className={userPanelItemCls}
                  >
                    {settings.theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
                  </button>
                ) : (
                  <div className="flex items-center rounded-lg py-2 px-3 gap-3 text-sm text-sidebar-text">
                    {settings.theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
                    <span className="flex-1">Theme Mode</span>
                    <button
                      onClick={toggleTheme}
                      className={clsx(
                        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 flex-shrink-0',
                        settings.theme === 'dark' ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                      )}
                    >
                      <span className={clsx(
                        'inline-block h-3 w-3 rounded-full bg-white transition-transform duration-200',
                        settings.theme === 'dark' ? 'translate-x-5' : 'translate-x-1'
                      )} />
                    </button>
                  </div>
                )}
              </>
            ) : (
              l1Children.map(item => (
                <SubItem key={item.id} item={item} menuItems={menuItems}
                  isCollapsed={col2Collapsed} isSelected={selectedL2Id === item.id}
                  isActive={item.type === 'container' ? activeL1Id === item.id : item.id === activeRouteId}
                  onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
                  onContainerClick={() => handleL2Click(item)} />
              ))
            )}
```

Replace with:
```typescript
                <Link
                  href="/profile"
                  onMouseEnter={effCol2Collapsed ? e => showTooltip(e, 'Profile') : undefined}
                  onMouseLeave={effCol2Collapsed ? hideTooltip : undefined}
                  className={clsx(
                    userPanelItemCls,
                    pathname === '/profile' ? 'bg-sidebar-active-bg text-sidebar-active-text font-medium ring-1 ring-inset ring-primary/70' : ''
                  )}
                >
                  <User size={16} className={pathname === '/profile' ? 'text-primary' : ''} />
                  {!effCol2Collapsed && <span>Profile</span>}
                </Link>

                {/* Theme Mode */}
                {effCol2Collapsed ? (
                  <button
                    onClick={toggleTheme}
                    onMouseEnter={e => showTooltip(e, settings.theme === 'light' ? 'Switch to Dark' : 'Switch to Light')}
                    onMouseLeave={hideTooltip}
                    className={userPanelItemCls}
                  >
                    {settings.theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
                  </button>
                ) : (
                  <div className="flex items-center rounded-lg py-2 px-3 gap-3 text-sm text-sidebar-text">
                    {settings.theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
                    <span className="flex-1">Theme Mode</span>
                    <button
                      onClick={toggleTheme}
                      className={clsx(
                        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 flex-shrink-0',
                        settings.theme === 'dark' ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                      )}
                    >
                      <span className={clsx(
                        'inline-block h-3 w-3 rounded-full bg-white transition-transform duration-200',
                        settings.theme === 'dark' ? 'translate-x-5' : 'translate-x-1'
                      )} />
                    </button>
                  </div>
                )}
              </>
            ) : (
              l1Children.map(item => (
                <SubItem key={item.id} item={item} menuItems={menuItems}
                  isCollapsed={effCol2Collapsed} isSelected={selectedL2Id === item.id}
                  isActive={item.type === 'container' ? activeL1Id === item.id : item.id === activeRouteId}
                  onShowTooltip={showTooltip} onHideTooltip={hideTooltip}
                  onContainerClick={() => handleL2Click(item)} />
              ))
            )}
```

- [ ] **Step 11: Logout button uses `effCol2Collapsed`**

Find:
```typescript
              <button
                onClick={signOut}
                onMouseEnter={col2Collapsed ? e => showTooltip(e, 'Logout') : undefined}
                onMouseLeave={col2Collapsed ? hideTooltip : undefined}
                className={userPanelItemCls}
              >
                <LogOut size={16} />
                {!col2Collapsed && <span>Logout</span>}
              </button>
```

Replace with:
```typescript
              <button
                onClick={signOut}
                onMouseEnter={effCol2Collapsed ? e => showTooltip(e, 'Logout') : undefined}
                onMouseLeave={effCol2Collapsed ? hideTooltip : undefined}
                className={userPanelItemCls}
              >
                <LogOut size={16} />
                {!effCol2Collapsed && <span>Logout</span>}
              </button>
```

- [ ] **Step 12: Col3 `aside` width, `ColToggle`, header, and subitem list use `effCol3Collapsed`**

Find:
```typescript
      {l2Children.length > 0 && (
        <aside className={clsx(
          'h-screen bg-sidebar-bg text-sidebar-text border-r border-sidebar-text/10 flex flex-col flex-shrink-0 relative transition-all duration-300',
          col3Collapsed ? ICON_SUB_W : TEXT_SUB_W
        )}>
          <ColToggle collapsed={col3Collapsed} onToggle={() => setCol3Collapsed(c => !c)} />
          {!col3Collapsed && (
            <div className="px-4 py-3 border-b border-sidebar-text/10 overflow-hidden">
              <TruncatedSpan
                text={menuItems.find(i => i.id === selectedL2Id)?.label ?? ''}
                className="block truncate text-xs font-semibold uppercase tracking-wider opacity-50"
                onShowTooltip={showTooltip}
                onHideTooltip={hideTooltip}
              />
            </div>
          )}
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1 scrollbar-hide">
            {l2Children.map(item => (
              <SubItem key={item.id} item={item} menuItems={menuItems}
                isCollapsed={col3Collapsed} isSelected={false}
```

Replace with:
```typescript
      {l2Children.length > 0 && (
        <aside className={clsx(
          'h-screen bg-sidebar-bg text-sidebar-text border-r border-sidebar-text/10 flex flex-col flex-shrink-0 relative transition-all duration-300',
          effCol3Collapsed ? ICON_SUB_W : TEXT_SUB_W
        )}>
          <ColToggle collapsed={effCol3Collapsed} onToggle={() => setCol3Collapsed(c => !c)} disabled={isNarrowViewport} />
          {!effCol3Collapsed && (
            <div className="px-4 py-3 border-b border-sidebar-text/10 overflow-hidden">
              <TruncatedSpan
                text={menuItems.find(i => i.id === selectedL2Id)?.label ?? ''}
                className="block truncate text-xs font-semibold uppercase tracking-wider opacity-50"
                onShowTooltip={showTooltip}
                onHideTooltip={hideTooltip}
              />
            </div>
          )}
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1 scrollbar-hide">
            {l2Children.map(item => (
              <SubItem key={item.id} item={item} menuItems={menuItems}
                isCollapsed={effCol3Collapsed} isSelected={false}
```

- [ ] **Step 13: Run the tests to verify they pass**

With the dev server still running from Step 2:
```bash
uv run pytest sources/tests/e2e/test_sidebar.py -v
```

Expected: PASS for all tests in the file, including the 2 new ones and every pre-existing test (`test_l1_sidebar_visible`, `test_l1_expands`, `test_l1_collapses`, `test_admin_opens_l2`, `test_master_collapse_hides_sidebar`, etc. — none of their selectors or default states changed).

- [ ] **Step 14: Manual browser verification**

With the dev server running, open `http://localhost:3000` in a browser (or drive it via the webapp-testing skill), log in, and check:
- Expand col1 to text mode (click the chevron), open Admin so col2 shows text-mode subitems.
- Resize the browser window narrower than 768px: col1 and col2 both switch to icon-only, their chevron toggle buttons disappear, and no layout squeeze/overlap occurs.
- Resize back above 768px: col1 and col2 return to text mode exactly as left before narrowing, chevron toggles reappear.
- With the window narrow, click the "Collassa menu" master-collapse button: the thin rail still appears exactly as before (unaffected by viewport width). Expand it again.
- Reload the page while narrow: col1/col2 render in icon-only mode (forced by viewport), and after widening the window past 768px without reloading, they return to the saved text-mode preference (confirming the override never touched localStorage).

- [ ] **Step 15: Commit**

```bash
git add sources/microservices/web-construct/components/Sidebar.tsx sources/tests/e2e/test_sidebar.py
git commit -m "$(cat <<'EOF'
feat(sidebar): auto-collapse menu columns to icons below 768px

Forces col1/col2/col3 into icon-only mode when the viewport narrows
below 768px, independent of the master full-collapse control and
without overwriting the user's saved per-column preference.
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- `isNarrowViewport` state + `matchMedia` listener → Step 4.
- `effCol1Collapsed`/`effCol2Collapsed`/`effCol3Collapsed` derived, non-persisted → Step 4.
- All three columns forced to icon-only below 768px → Steps 6-12 (col1: 6-8, col2: 9-11, col3: 12).
- `ColToggle` disappears (not just visually disabled) below the breakpoint → Step 3 (component), Steps 6/9/12 (call sites pass `disabled={isNarrowViewport}`).
- Master-collapse button always clickable, only its label visibility follows `effCol1Collapsed` → Step 6 (no change to `onClick`).
- No new localStorage key, raw `colXCollapsed` state/setters/persistence untouched → confirmed structurally (Step 4's `useEffect` for `localStorage.setItem` is unchanged; only reads after that point were touched).
- e2e tests for forced-narrow and restore-on-widen, for both col1 and col2 → Step 1.
- Manual browser check including master-collapse interaction while narrow → Step 14.

**Placeholder scan:** No TBD/TODO; every step has literal, complete code or exact commands.

**Type consistency:** `effCol1Collapsed`/`effCol2Collapsed`/`effCol3Collapsed` names match across Steps 4-12. `isNarrowViewport` matches between Step 4's declaration and its use as `disabled={isNarrowViewport}` in Steps 6/9/12. `ColToggle`'s new `disabled?: boolean` prop (Step 3) matches its usage at every call site (Steps 6/9/12).
