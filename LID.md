# Linked-Intent Development (LID)

This project follows the **LID methodology**. All agents MUST adhere to the **Arrow of Intent** for feature additions and bug fixes.

## The Arrow of Intent
All changes start with intent, moving from high-level to low-level:
`HLD → LLD → EARS → Tests → Code`

1.  **HLD (High-Level Design)**: Architectural strategy and trade-off decisions.
2.  **LLD (Low-Level Design)**: Detailed component design and edge-case probing.
3.  **EARS (Specs)**: Formalized requirements (Easy Approach to Requirements Syntax).
4.  **Tests (TDD)**: Implementation-verifying tests annotated with requirement IDs.
5.  **Code (Dev)**: Minimal implementation annotated with requirement IDs.

**MANDATORY**: Pause and wait for user approval after each design stage (HLD, LLD, EARS).

**Abbreviated mode for this effort** (pre-draft time crunch): README-first; HLD/LLD/EARS are deferred to post-draft-season unless a slice genuinely needs one. Bug fixes still walk the arrow — locate the intent gap before patching.

## Core Principles
- **Documentation is Truth**: Code is the "compiled" output of design. If they disagree, the documentation wins; fix the code or update the design and cascade the change.
- **Intent Gaps > Bugs**: Most failures are misaligned intent. When a bug is found, "walk the arrow" from the top down to identify where the intent diverged.
- **Traceability**: All code entry points and tests must carry `@spec [ID]` comments (e.g., `# @spec APP-AUTH-001`) once specs exist for the slice.

## Design Templates

### HLD (`docs/high-level-design.md`)
- **Goal**: Clear objective.
- **Strategy**: Compare options and state the chosen path + why.
- **Architecture**: High-level component flow.
#### HLD Template
Path: `docs/high-level-design.md`
```markdown
# HLD: [Feature Name]

## Goal
Short description of the objective.

## Strategy
- **Options**: [Briefly list alternatives]
- **Decision**: [Chosen path + Why]

## Architecture
- [High-level components/flow]
```
### LLD (`docs/llds/*.md`)
- **Data Model**: Key types or schemas.
- **Logic Flow**: Sequential steps or pseudocode.
- **Edge Case Probe**: Explicitly list potential failures and how they are handled.
#### LLD Template
Path: `docs/llds/[component-name].md`
```markdown
# LLD: [Component Name]

## Interface / Data Model
[Key types, signatures, or schemas]

## Logic Flow
[Sequential steps or pseudocode]

## Edge Case Probe
- [Condition] -> [Handling]
```

### EARS (`docs/specs/*.md`)
Format: `ID | Requirement | Status`
- **ID**: Unique identifier (e.g., `FEAT-001`).
- **Requirement**: `[WHEN] [IF] THE <SYSTEM> SHALL <RESULT>`.
- **Status**: `[ ]` Active, `[x]` Implemented, `[D]` Deferred.
#### EARS Template
Path: `docs/specs/[feature-name]-specs.md`
Format: `ID | Description | Status`
```markdown
# Specs: [Feature Name]

| ID | Requirement | Status |
|---|---|---|
| [ID]-001 | [WHEN] [IF] THE <SYSTEM> SHALL <RESULT> | [ ] |
```
*Status: `[ ]` Active, `[x]` Implemented, `[D]` Deferred.*

When a GitHub issue is created for a spec, annotate it with `→ #N` after the status marker:
```
**BBPL-UI-001** `[ ]` → #12
```
Specs without `→ #N` still need an issue. Grep for `→ #` to see all covered specs.
## Bug Fixing (Intent Gap Protocol)
1.  **Locate**: Find where behavior diverges from existing EARS/LLD.
2.  **Fix Intent**: Update the HLD/LLD/EARS to reflect the corrected behavior.
3.  **Cascade**: Update tests, then update code.
