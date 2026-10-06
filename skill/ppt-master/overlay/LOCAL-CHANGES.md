# Local Changes

This file records local modifications to this Skill. It is **not** part of the
upstream distribution and is not referenced by any workflow. Reinstalling or
updating the Skill from `https://github.com/hugohe3/ppt-master` discards these
changes; reapply them from the diffs below.

The attribution guard (`scripts/attribution_guard.py`) does not read this file.
It validates the frontmatter metadata values, the `LICENSE` digest, the required
attribution files, and the executable gate calls — none of which these changes
touch. Run it after reapplying to confirm.

| Date | File | Change |
|---|---|---|
| 2026-10-06 | `SKILL.md` | Added `## Pre-Flight Intake` (between the route table and `## Authored Expression Range`) |
| 2026-10-06 | `workflows/routing.md` | Added "Local exception — pre-flight intake" paragraph under §1 Routing Discipline |
| 2026-10-06 | `SKILL.md` | Added `## Cost Discipline` (between `## Pre-Flight Intake` and `## Authored Expression Range`) |
| 2026-10-06 | `workflows/routing.md` | Added "Local note — Quick is not the cheaper route" paragraph under §1 Routing Discipline |

## What the change does

Before the selected route's Step 1, ask the user **once, in one message, in their
language**:

1. **Confirmation surface** — confirm in the browser page, or in chat? Applies to
   every route that runs a confirmation stage.
2. **Generation depth** — full pipeline (Default) or Quick? Generate routes only.

Then wait. Source processing, project initialization, image work, and the
confirmation page must not start before both answers exist.

Guards kept in the wording, so the addition cannot fight upstream rules:

- It is explicitly **not** the route-choice menu that `routing.md` §1 forbids —
  it selects a profile/delivery preference *inside* the already-routed row and
  never offers Create Template or Edit Native PPTX as alternatives.
- Any question the user already answered (same request or earlier message) is
  skipped; an explicit instruction always wins.
- Unanswered questions fall back to upstream defaults (browser page; the profile
  the routing authority resolves on its own).
- It never replaces a Stage-1/Stage-2 confirmation; the route still owns its gates.

## Reapply

`SKILL.md` — insert this immediately after the "Hard rule — selected authority
only" paragraph, before `## Authored Expression Range`:

```markdown
---

## Pre-Flight Intake

**Local addition — not part of the upstream Skill.** Upstream derives both
answers below from the request and its own defaults; this deployment asks
instead, because a wrong default here costs the user a whole planning round.

After route selection and **before** the selected authority's Step 1, ask the
applicable questions below **in one message**, then wait for the answer. Do not
begin source processing, project initialization, image work, or the confirmation
page first.

| # | Question (ask in the user's language) | Asked for |
|---|---|---|
| 1 | 确认方式：在**浏览器页面**里确认，还是**直接在对话里**确认？ | every route that runs a confirmation stage |
| 2 | 生成深度：走**完整流程**（两次确认 + spec/lock + 质量门禁），还是**快速生成**？ | Generate PPTX routes only |

**Precedence and scope**:

- Both answers are explicit user instructions. Answer 1 satisfies the surface
  decision in [`confirm-surface.md`](references/confirm-surface.md) §1 and keeps
  chat as the surface for the rest of the run; answer 2 satisfies the Quick
  trigger in [`routing.md`](workflows/routing.md) §3.
- Asking these is **not** the route-choice menu prohibited by
  [`routing.md`](workflows/routing.md) §1. That rule forbids offering competing
  implementation paths when the request already matches one matrix row; these two
  questions select a profile and a delivery preference *within* the routed row and
  never present Create Template or Edit Native PPTX as alternatives.
- Ask each question at most once per run. Skip any question the user already
  answered in the same request or an earlier message — an explicit instruction
  always wins over this intake.
- If the user does not answer, fall back to the upstream defaults: the
  confirmation page for question 1, and whatever profile the routing authority
  resolves on its own for question 2.
- This intake never replaces a Stage-1 or Stage-2 confirmation. The selected
  route still owns its own gates, and a Quick run still owns its own procedure.
```

`workflows/routing.md` — append after the "Forbidden — route-choice menus"
paragraph in §1:

```markdown
**Local exception — pre-flight intake**: before the selected route's Step 1, this deployment asks the user once whether to confirm in the browser or in chat, and — for a Generate request — whether to run the full pipeline (Default) or Quick. This is a delivery-preference question inside the already-routed row, not a route menu: it never offers Create Template or Edit Native PPTX as alternatives, it is asked at most once, it is skipped when the user already stated either answer, and an unanswered question falls back to this file's own resolution. Definition and precedence: `SKILL.md` §Pre-Flight Intake.
```

## Second change (2026-10-06): Cost Discipline

Added after a run that was judged both expensive and image-less. The clause
records the measured cost shape so that "Quick" is not mistaken for "cheap", and
forbids letting a speed argument drop a content requirement.

`SKILL.md` — insert between `## Pre-Flight Intake` and `## Authored Expression Range`:

```markdown
---

## Cost Discipline

**Local addition — not part of the upstream Skill.** Measured from real runs of
this deployment, recorded so that a cheap-looking choice is not mistaken for a
cheap run.

**Reference — the cost shape.** Before the first page, every run must read the
authoring contract: `executor-base.md` (~53 KB), `shared-standards-core.md`
(~33 KB), `preset-shape-vocabulary.md` (~10 KB), `semantic-svg.md`, the route
authority, and for Default the resolved spec and lock. That is on the order of
150 KB of mandatory reading, paid identically by a 3-page deck and a 20-page one.
Per-page cost therefore **falls** as the roster grows: below roughly 8 pages the
fixed contract load dominates and a lighter method is usually the better tool.

**Hard rule — Quick is not the cheap option.** Quick removes *process* — the
confirmation stages, the root spec and lock, speaker notes, `finalize_svg.py` —
and **not** execution. The contract reading and the hand-authored SVG per page
are the same under Quick. Choosing Quick to save money is a category error. What
Quick actually trades away is **reusability**: with no lock to edit, a later
restyle or page-count change restarts the run instead of re-entering at its
execution stage. When the user expects to revise, restyle, or reuse the deck,
the planning artifacts are the cost lever, not overhead.

**Hard rule — a cost or speed argument never removes a content requirement.**
Visual grounding is content, not decoration. When the audience must recognize,
experience, or compare a specific external subject — historical material, a real
product, a named place, a person, an artefact — the deck needs images of it.
Omitting them to keep the run fast still pays the full contract load and delivers
a deck that fails its purpose. Decide grounding at planning time, state the
decision and its reason, and never let a Quick run silently downgrade it to zero
images.

**Default — state the cost shape before starting.** When a request implies a
large, small, or repeated run, say what is fixed and what scales before the first
page, so the user chooses the roster and the route against real numbers rather
than a guess. When a lighter method fits the request better than this Skill, say
so before the run, not after.
```

`workflows/routing.md` — append immediately after the "Local exception —
pre-flight intake" paragraph:

```markdown
**Local note — Quick is not the cheaper route**: Quick removes process, not execution. The authoring contract is read and every page is hand-authored either way, so the two largest costs are unchanged; what Quick gives up is reusability, because without a lock a later restyle or page-count change restarts the run instead of re-entering at its execution stage. Route to Quick for a genuine one-off, never to save cost, and never let a Quick run drop an image requirement the subject needs. See `SKILL.md` §Cost Discipline.
```

## Constraint to respect when editing

`SKILL.md` must contain the exact string
`python3 "${SKILL_DIR}/scripts/attribution_guard.py"` **exactly once**. Do not
quote that command in any added text — a second occurrence fails the integrity
gate and stops the Skill.

Backups from the 2026-10-06 edit: `SKILL.md.20261006-142118.bak`,
`workflows/routing.md.20261006-142118.bak`.
