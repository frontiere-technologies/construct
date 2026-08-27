## React and TypeScript conventions

### Language and tooling

- Prefer TypeScript for all application code.
- Use `.tsx` only for files containing JSX; use `.ts` otherwise.
- Keep TypeScript strict. Do not weaken compiler options to accommodate one implementation.
- Use ESM imports and `moduleResolution: "bundler"` where supported.
- Let the configured formatter organize whitespace, wrapping, semicolons, and imports.
- Use single quotes in JavaScript and TypeScript.
- Run lint, typecheck, and the smallest relevant test suite before handoff.
- Fix unused variables. Prefix intentionally unused parameters with `_` only when required by an external signature.
- Do not use `console.log` or `console.debug` in production code. Use `console.info`, `console.warn`, or `console.error` only when operationally useful.

### Files and directories

- Use `kebab-case` for application files and directories:
  - `user-profile.tsx`
  - `account-settings.tsx`
  - `use-media-query.ts`
  - `format-user-name.ts`
- Keep framework-reserved filenames unchanged, such as `page.tsx`, `layout.tsx`, `route.ts`, and `error.tsx`.
- Colocate tests with their implementation:
  - `user-profile.spec.tsx`
  - `format-user-name.spec.ts`
- Use `.slow.spec.ts(x)` or an equivalent suffix only when the test runner has a dedicated slow-test lane.
- A component file may contain small private subcomponents that belong exclusively to its public component. Extract them when reused or independently meaningful.
- Do not define React components inside another component body.

For reusable library code, a file may instead mirror its main public symbol:

- `UserProfile.tsx`
- `UserService.ts`
- `useCurrentUser.ts`

Do not mix the application and library filename strategies within the same folder.

### Naming

- Components, classes, contexts, types, and enums: `PascalCase`.
- React hooks: `usePascalCase`.
- Variables, parameters, functions, and object properties: `camelCase`.
- Boolean values should communicate their predicate:
  - `isLoading`
  - `hasPermission`
  - `canSubmit`
  - `shouldRefresh`
- Callback props use `onX`: `onChange`, `onSubmit`, `onOpenChange`.
- Local event handlers use `handleX`: `handleSubmit`, `handleOpenChange`.
- State setters use the React convention: `setOpen`, `setCurrentUser`.
- Preserve established acronym casing consistently: `APIClient`, `AIMessage`, `HTMLRenderer`.
- Use `UPPER_SNAKE_CASE` for module-level immutable literals and fixed configuration:
  - `DEFAULT_PAGE_SIZE`
  - `REQUEST_TIMEOUT_MS`
  - `ABSOLUTE_URL_REGEX`
- Do not uppercase every `const`. Local values, factory results, contexts, variants, and components retain semantic casing:
  - `buttonVariants`
  - `getServerSnapshot`
  - `UserContext`
  - `UserProfile`
- Abstract classes and interfaces do not receive `A` or `I` prefixes unless an existing subsystem consistently requires them.

### Imports and exports

- Put `'use client';` or other module directives before imports.
- Use `import type` for type-only dependencies.
- Keep imports in formatter-defined groups:
  1. React and framework imports
  2. External packages
  3. Internal aliases
  4. Relative imports
- Use the configured source alias for cross-feature imports, such as `@/`.
- Use relative imports for files in the same local module.
- Prefer named exports for components, hooks, utilities, and types.
- Use default exports only when required by the framework or an external integration.
- Export only intentional public APIs. Keep implementation helpers private to their module.
- Do not create wrappers or barrels that add no meaningful boundary.

### Types

- Prefer `type` over `interface` for application-level props and data shapes.
- Type simple component props inline:

  ```tsx
  export function UserAvatar({
    name,
    src,
  }: {
    name: string;
    src?: string;
  }) {
    // ...
  }