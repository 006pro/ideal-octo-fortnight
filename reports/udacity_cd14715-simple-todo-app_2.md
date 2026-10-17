# 🔍 Code Review Report

## Summary

| Metric | Value |
|--------|-------|
| **Overall Score** | 15/100 |
| **Files Reviewed** | 1 |
| **Critical Issues** | 4 |
| **High Priority Tests** | 6 |
| **Refactoring Opportunities** | 6 |

## 🎯 Top Recommendations

1. 🚨 **Security**: Immediately fix all three SQL injection vulnerabilities by converting string concatenation/interpolation to parameterized queries using $1, $2 placeholders in searchTodos, searchTodosByStatus, and getTodosByUser functions
   - Files: src/todo.ts

2. 🚨 **Testing**: Add security tests to verify SQL injection prevention for all three new search functions (searchTodos, searchTodosByStatus, getTodosByUser) with malicious input like "'; DROP TABLE todos; --" and "' OR '1'='1"
   - Files: src/todo.ts

3. ⚠️ **Security**: Fix type inconsistency in searchTodosByStatus by changing the completed parameter from string to boolean to prevent type coercion vulnerabilities and match the Todo interface
   - Files: src/todo.ts

4. ⚠️ **Testing**: Add functional tests for all three new search functions to verify correct behavior: keyword search matches title and description, status filtering returns only completed/incomplete todos, and user filtering returns only that user's todos
   - Files: src/todo.ts

5. ⚠️ **Security**: Add input validation to search functions: validate keyword length (prevent DoS), validate userId format (alphanumeric only), and handle empty/null inputs gracefully
   - Files: src/todo.ts

## 📁 File Details

### 📄 `src/todo.ts`

**Quality Score:** 25/100 | **Coverage:** ~0%

#### Issues (11)
  - Line 120: `critical` SQL injection vulnerability: user-supplied keyword is directly interpolated into the SQL query using template literals, allowing attackers to execute arbitrary SQL commands (e.g., keyword = "'; DROP TABLE todos; --")
  - Line 129: `critical` SQL injection vulnerability: the completed parameter is concatenated directly into SQL without validation or parameterization, allowing attackers to inject malicious SQL (e.g., completed = "true OR 1=1")
  - Line 138: `critical` SQL injection vulnerability: userId is directly embedded in a SQL query with template literals, allowing attackers to inject malicious SQL through the userId parameter (e.g., userId = "' OR '1'='1")

  *...and 8 more*

#### Test Gaps (10)
  - `searchTodos (line 119)` (critical priority)
  - `searchTodos (line 119)` (high priority)

  *...and 8 more*

#### Refactoring Opportunities (6)
  - **pattern-improvement**: Extract the parameterized query pattern used in existing functions into a consistent approach for all three new search functions. The codebase already demonstrates the correct pattern in createTodo, getTodoById, updateTodoStatus, and deleteTodo.
  - **modernize**: Change the parameter type from string to boolean to match TypeScript's type system and the Todo interface definition where completed is boolean. This eliminates type confusion and potential runtime errors.

  *...and 4 more*

---

*Generated at 2026-10-17T19:05:19.067Z • Duration: 210438ms*
