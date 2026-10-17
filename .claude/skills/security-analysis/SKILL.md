---
description: Security-focused code review covering OWASP Top 10 vulnerabilities, secret handling, injection, XSS, and secure coding practices for JavaScript/TypeScript
---

# Security Analysis

Expert in application security for web/Node.js code. Use this guidance to find exploitable
weaknesses in changed code and rate them consistently.

## Injection (OWASP A03)
- SQL/NoSQL built with string concatenation or template literals → use parameterized queries
- `eval`, `new Function`, `setTimeout("string")`, `vm.runInContext` on user input → critical
- `child_process.exec` with interpolated input → use `execFile`/`spawn` with an args array
- Regex built from user input without escaping (ReDoS / logic bypass)

```js
// BAD
db.query(`SELECT * FROM users WHERE id = ${req.params.id}`);
// GOOD
db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
```

## Cross-Site Scripting (XSS)
- `innerHTML`, `outerHTML`, `document.write`, `insertAdjacentHTML` with untrusted data
- React `dangerouslySetInnerHTML` without sanitizing (DOMPurify)
- Building HTML strings from search terms / todo titles / query params
- `href`/`src` attributes accepting `javascript:` URLs

```js
// BAD
list.innerHTML += `<li>${todo.title}</li>`;
// GOOD
const li = document.createElement('li');
li.textContent = todo.title;
list.appendChild(li);
```

## Broken Access Control & Business Logic (OWASP A01)
- Authorization decided on the client (e.g. `isPremium` flag in localStorage, request body, or a query param)
- Feature gates / paywalls enforced only in the UI
- Missing ownership checks (user A can modify user B's resource by id)
- Price, plan, or discount values trusted from the client

## Cryptographic Failures & Secrets (OWASP A02)
- Hard-coded API keys, tokens, passwords, license keys, or payment secrets → critical
- Secrets committed in config or fixtures; `.env` values logged
- `Math.random()` for tokens/IDs/coupons → use `crypto.randomUUID()` / `crypto.getRandomValues`
- Weak hashing (MD5/SHA1) for passwords → bcrypt/argon2

## Insecure Data Handling
- Sensitive data (payment info, emails, tokens) stored in `localStorage`/`sessionStorage`
- `JSON.parse` on untrusted input without try/catch or schema validation
- Prototype pollution: merging user objects into `{}` with recursive assign, `__proto__` keys
- Missing input validation / length limits on user-supplied strings

## Security Misconfiguration & Logging
- Permissive CORS (`*` with credentials), missing CSRF protection on state-changing routes
- Verbose error messages / stack traces returned to clients
- Logging secrets or full request bodies

## Dependency Risks
- Importing from unpinned CDNs or unknown packages; `npm install` of typo-squatted names

## Severity Guide
- **critical**: Remote code execution, hard-coded secrets, auth/payment bypass, SQL injection
- **high**: Stored/reflected XSS, client-side-only authorization, sensitive data in localStorage
- **medium**: Missing input validation, insecure randomness for non-secret IDs, verbose errors
- **low**: Defense-in-depth gaps (missing CSP headers, overly broad try/catch hiding errors)
- **info**: Hardening suggestions with no direct exploit path

## Output
For each finding report: exact line number, severity (per guide above), category `security`,
a one-sentence description of the exploit scenario, and a concrete fix (code where possible).
Do not report theoretical issues that cannot be reached from the changed code.
