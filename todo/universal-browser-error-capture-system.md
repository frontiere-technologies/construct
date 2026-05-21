PROJECT TASK: Implement a Universal Browser Error Capture System

Goal
Create a lightweight JavaScript module that automatically captures all browser errors normally visible in the Developer Tools Console and exposes them programmatically.

The module must be framework-agnostic and work in any browser environment.

---

FEATURE REQUIREMENTS

The module must capture:

1. Runtime JavaScript errors
2. Unhandled Promise rejections
3. console.error() calls
4. console.warn() calls
5. Script loading errors
6. Stack traces when available

All captured events must be stored in a global error store and optionally sent to a backend endpoint.

---

GLOBAL API

Expose the following globals:

window.**JS_ERRORS**
An array containing all captured error objects.

window.getErrors()
Returns the error list.

window.clearErrors()
Clears the error store.

Example usage:

```javascript
console.log(getErrors())
```

---

ERROR OBJECT FORMAT

Each error must follow this structure:

```
{
  type: "runtime | promise | console.error | console.warn | resource",
  message: "error message",
  source: "file url",
  lineno: number,
  colno: number,
  stack: "stack trace if available",
  time: ISO_TIMESTAMP
}
```

---

CORE IMPLEMENTATION

Implement the following logic.

1. Runtime errors

Use window.onerror.

Example:

```javascript
window.onerror = function(message, source, lineno, colno, error) {
  saveError({
    type: "runtime",
    message,
    source,
    lineno,
    colno,
    stack: error?.stack
  })
}
```

2. Unhandled promise rejections

```javascript
window.addEventListener("unhandledrejection", event => {
  saveError({
    type: "promise",
    message: event.reason?.message || event.reason,
    stack: event.reason?.stack
  })
})
```

3. Intercept console methods

Override console.error and console.warn.

Example:

```javascript
const originalError = console.error

console.error = (...args) => {
  saveError({
    type: "console.error",
    message: args.join(" ")
  })

  originalError.apply(console, args)
}
```

4. Resource loading errors

Capture script or asset loading failures.

```javascript
window.addEventListener("error", function(event) {

  if (event.target !== window) {

    saveError({
      type: "resource",
      message: `Failed to load resource`,
      source: event.target.src || event.target.href
    })

  }

}, true)
```

---

ERROR STORE IMPLEMENTATION

Create an internal store:

```javascript
const errorStore = []
```

Implement helper:

```javascript
function saveError(error) {

  const entry = {
    time: new Date().toISOString(),
    ...error
  }

  errorStore.push(entry)

}
```

Expose globally:

```javascript
window.__JS_ERRORS__ = errorStore
window.getErrors = () => errorStore
window.clearErrors = () => errorStore.length = 0
```

---

OPTIONAL: SERVER LOGGING

Add optional backend logging.

If endpoint exists:

POST /js-error-log

Example:

```javascript
fetch("/js-error-log", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(entry)
})
```

This must be wrapped in try/catch so failures do not break the page.

---

TEST CASES

Create demo examples that trigger errors.

Example 1: runtime error

```javascript
undefinedFunction()
```

Example 2: promise rejection

```javascript
Promise.reject(new Error("Promise failed"))
```

Example 3: console error

```javascript
console.error("Manual console error")
```

Verify they appear in:

```
window.__JS_ERRORS__
```

---

DELIVERABLES

Create:

1. error-catcher.js
2. Example HTML demo page
3. Inline documentation comments

---

CONSTRAINTS

* No external dependencies
* Works in modern browsers
* Must not break existing console behavior
* Must be under ~120 lines of code
* Must fail safely

---

END OF TASK
