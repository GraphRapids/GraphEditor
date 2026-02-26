# GraphEditor Autocomplete Behavior Spec

Use this file to define exact autocomplete behavior.

Rules for writing/updating scenarios:
- Use `|` as the cursor marker.
- Keep YAML examples minimal.
- List suggestions in exact expected order.
- State exactly what is inserted when a suggestion is accepted.
- Preserve leading spaces in suggestion labels exactly as written.

General spacing rule (applies to all scenarios):
- Suggestion label spacing is semantic and must be matched exactly.
- `- name` style labels represent list-item starts and have no leading spaces before `-`.
- `  key` style labels represent in-object keys and have exactly two leading spaces.
- Per-object uniqueness rule:
  - For a given node object, do not suggest `  type`, `  ports`, or `  nodes` if that key already exists on that same node.

---

## 1) Source Of Truth

- Schema URL/version: `http://127.0.0.1:8000/schemas/minimal-input.schema.json` (current runtime schema)
- Additional business rules:
  - Never suggest values for `nodes[].name` and `links[].label`.
  - Suggest values for `nodes[].type` and `links[].type`.
  - Suggest `links[].from`/`links[].to` values only from node names already defined in `nodes`.
- Should behavior prefer strict schema only: `no` (schema-first with UX guidance rules)

---

## 2) Global Behavior

- Suggest opens on:
  - [x] Empty document on mount
  - [x] Editor focus
  - [x] `Enter`
  - [x] `Tab`
  - [x] `:`
  - [x] Backspace dedent
- Suggest auto-opens after accepting completion: `yes`
- If no valid suggestions exist: hide suggest box
- Free-text-only value fields: `nodes[].name`, `links[].label`
- Implemented behavior:
  - Selecting a value for `nodes[].type` or `links[].type` inserts the value, creates the next line with matching indentation, and reopens suggestions.

---

## 3) Field Policy Matrix

| Path | Suggest Keys? | Suggest Values? | Value Source | Free Text Allowed? | Notes |
|---|---|---|---|---|---|
| `root` | Yes | No | n/a | n/a | Suggest only `nodes`, `links` (ordered by missing section first). |
| `nodes[]` | Yes | No | n/a | n/a | New item start suggests only `name`; in-object keys must exclude keys already set on the current node. |
| `nodes[].name` | No | No | n/a | Yes | User input only. |
| `nodes[].type` | No | Yes | active profile `nodeTypes` catalog | Yes | Suggestions shown, manual value allowed. |
| `links[]` | Yes | No | n/a | n/a | New item start suggests only `from`. |
| `links[].from` | No | Yes | defined `nodes[].name` values only | Yes | No suggestions if no nodes exist. |
| `links[].to` | No | Yes | defined `nodes[].name` values only | Yes | No suggestions if no nodes exist. |
| `links[].label` | No | No | n/a | Yes | User input only. |
| `links[].type` | No | Yes | active profile `linkTypes` catalog | Yes | Suggestions shown, manual value allowed. |

---

## 4) Filled Core Scenarios

### Scenario 1: Empty document

Context:
- Purpose: start authoring quickly from blank state.
- Preconditions: document is empty.

Input:
```yaml
|
```

Expected suggestions (order):
1. `nodes`
2. `links`

When user selects: `nodes`

Expected inserted text:
```yaml
nodes:
  - name: |
```

After insertion:
- Auto-trigger suggest again: `no` (name value is free text)

---

### Scenario 2: After selecting `nodes`

Input:
```yaml
nodes:
  - |
```

Expected suggestions:
1. `name`

When user selects: `name`

Expected inserted text:
```yaml
nodes:
  - name: |
```

---

### Scenario 3: After entering node name + Enter

Input:
```yaml
nodes:
  - name: <any-node-name>
  |
```

Expected suggestions (exact labels, spacing is significant):
1. `- name`
2. `  type`
3. `  ports`
4. `  nodes`

Spacing rule for this scenario:
- `- name` has no leading spaces before `-`.
- `  type`, `  ports`, `  nodes` each have exactly two leading spaces.

Uniqueness rule for this scenario:
- If the current node already has `type`, do not suggest `  type`.
- If the current node already has `ports`, do not suggest `  ports`.
- If the current node already has `nodes`, do not suggest `  nodes`.

When user selects: `- name`

Expected inserted text:
```yaml
nodes:
  - name: <any-node-name>
  - name: |
```

After insertion:
- Auto-trigger suggest again: `no` (name value is free text)

When user selects: `  type`

Expected inserted text:
```yaml
nodes:
  - name: <any-node-name>
    type: |
```

After insertion:
- Auto-trigger suggest again: `yes`
- Expected suggestions: type values from the active profile catalog

When user selects: `  ports`

Expected inserted text:
```yaml
nodes:
  - name: <any-node-name>
    ports:
      - name: |
```

After insertion:
- Auto-trigger suggest again: `no` at `name` value (free text)

When user selects: `  nodes`

Expected inserted text:
```yaml
nodes:
  - name: <any-node-name>
    nodes:
      - name: |
```

After insertion:
- Auto-trigger suggest again: `no` at nested `name` value (free text)

---

### Scenario 4: After entering node type + Enter

Input:
```yaml
nodes:
  - name: foobar
    type: router
    |
```

Expected suggestions:
1. `name`

When user selects: `name`

Expected inserted text:
```yaml
nodes:
  - name: foobar
    type: router
  - name: |
```

---

### Scenario 5: Creating second node quickly

Input:
```yaml
nodes:
  - name: foobar
    type: router
  - |
```

Expected suggestions:
1. `name`

When user selects: `name`

Expected inserted text:
```yaml
nodes:
  - name: foobar
    type: router
  - name: |
```

---

### Scenario 6: After selecting `links`

Input:
```yaml
links: |
```

Expected suggestions:
1. `from`

When user selects: `from`

Expected inserted text:
```yaml
links:
  - from: |
```

---

### Scenario 7: `from` with no nodes defined

Input:
```yaml
links:
  - from: |
```

Expected suggestions:
- none

Expected behavior:
- User can type free text manually.
- Suggest box stays hidden.

---

### Scenario 8: `from` with nodes defined

Input:
```yaml
nodes:
  - name: A
  - name: B
links:
  - from: |
```

Expected suggestions:
1. `A`
2. `B`

When user selects: `A`

Expected inserted text:
```yaml
nodes:
  - name: A
  - name: B
links:
  - from: A|
```

After insertion:
- Auto-trigger suggest again: `yes`
- Next key suggestion after Enter should be `to`.

---

### Scenario 9: `to` with nodes defined

Input:
```yaml
nodes:
  - name: A
  - name: B
links:
  - from: A
    to: |
```

Expected suggestions:
1. `A`
2. `B`

When user selects: `B`

Expected inserted text:
```yaml
nodes:
  - name: A
  - name: B
links:
  - from: A
    to: B|
```

---

### Scenario 10: `label` value behavior

Input:
```yaml
links:
  - from: A
    to: B
    label: |
```

Expected suggestions:
- none

Expected behavior:
- User enters label text manually.

---

### Scenario 11: `type` value behavior for links

Input:
```yaml
links:
  - from: A
    to: B
    type: |
```

Expected suggestions (example):
1. `directed`
2. `undirected`
3. `association`
4. `dependency`
5. `generalization`
6. `none`

When user selects: `directed`

Expected inserted text:
```yaml
links:
  - from: A
    to: B
    type: directed
    |
```

After insertion:
- Auto-trigger suggest again: `yes`

---

### Scenario 12: Backspace dedent inside node item

Input:
```yaml
nodes:
  - name: foobar
    type: router
    |
```

Action:
- User presses Backspace on whitespace-only line.

Expected behavior:
- Dedent one level to list-item level and reopen suggestions.
- Suggested next step should be starting a new node item (`name` via `- name:` flow).

Expected resulting text:
```yaml
nodes:
  - name: foobar
    type: router
  |
```

Expected suggestions:
1. `name`

---

### Scenario 13: Backspace dedent inside link item

Input:
```yaml
links:
  - from: A
    to: B
    |
```

Action:
- User presses Backspace on whitespace-only line.

Expected behavior:
- Dedent one level and reopen suggestions for next link item start.

Expected resulting text:
```yaml
links:
  - from: A
    to: B
  |
```

Expected suggestions:
1. `from`

---

### Scenario 14: Root-level switching (`nodes` -> `links`)

Input:
```yaml
nodes:
  - name: A
|
```

Expected suggestions (order):
1. `links`
2. `nodes`

When user selects: `links`

Expected inserted text:
```yaml
nodes:
  - name: A
links:
  - from: |
```

---

## 5) Negative Scenarios (Must Not Happen)

- Never suggest values for:
  - `nodes[].name`
  - `links[].label`
- Never suggest key `id` anywhere (nodes or links).
- Never suggest `from/to` values when no `nodes[].name` exists.
- Never insert multi-field snippets automatically.
- Never reorder user-entered keys or values without explicit user action.

---

## 6) Acceptance Checklist

- [ ] All 14 scenarios pass manually.
- [ ] Tests cover all critical scenarios.
- [ ] Suggestion order matches this spec.
- [ ] Inserted text matches this spec.
- [ ] Forbidden suggestions never appear.
