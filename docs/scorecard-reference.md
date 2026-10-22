# Scorecard reference

A **scorecard** tells the evaluator what to judge and how. People write and freeze it before the thing it judges
exists, so the target never moves (PDF p.3-4). The evaluator only reads it.

A scorecard is a YAML (or JSON) file in the PDF's format (page 17). Two drafts to copy from:
[`samples/talentra/talentra-schema-d2.yaml`](../samples/talentra/talentra-schema-d2.yaml) (judges a schema, D1) and
[`samples/talentra/talentra-step04-d4.yaml`](../samples/talentra/talentra-step04-d4.yaml) (judges an output, D3).

## Contents

- [A minimal example](#a-minimal-example)
- [Top-level fields](#top-level-fields)
- [Which sheets the agent reads](#which-sheets-the-agent-reads)
- [Dimensions](#dimensions)
- [Built-in checks](#built-in-checks)
- [Bands: ratio to score](#bands-ratio-to-score)
- [Rules the parser enforces](#rules-the-parser-enforces)
- [Tips](#tips)

## A minimal example

```yaml
scorecard:
  id: SC-STEP01-D2
  name: Requirements docket schema scorecard
  version: "1.0"
  judges: D1 schema design · Step 01        # must start with D1 (schema) or D3 (output)
  frozen: true                              # required, or the evaluator refuses it
  approval: "Approved by <mentor>, 22 Oct 2026"
  thresholds: { accept: 90, refine: 75 }    # the defaults

  artifact:
    sheets:
      - { name: Tree, header_row: 1 }
  dimensions:
    - id: C01                                # measured by code: exact, free, repeatable
      name: Every node is defined
      weight: 15
      critical: true
      check:
        id: column_filled
        params: { sheet: Tree, column: Definition }
        bands: [{ min: 1.0, score: 5 }, { min: 0.97, score: 4 }, { min: 0.9, score: 3 }, { min: 0.01, score: 1 }]
        fix: Write a one-sentence definition for each listed node.

    - id: J01                                # judged by the three raters
      name: A newcomer could fill it in unaided
      weight: 10
      anchors:
        5: Every parameter says what to record, in what form, with an example where needed.
        4: Almost all are clear; a few need a short explanation.
        3: Most are clear, but several need the author to explain.
        2: Many parameters are ambiguous without help from the author.
        1: A newcomer could not fill most of it in unaided.
        0: Unusable without the author.

    - id: H01                                # only a person can supply this
      name: Author understanding
      weight: 10
      critical: true
      measured_by: human
      needs: A scored author interview (0-5) run by the mentor.
```

## Top-level fields

All under the `scorecard:` key.

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Short code, e.g. `SC-STEP01-D2` |
| `name` | no | Display name (defaults to `id`) |
| `version` | yes | Any string or number; shown in every report |
| `judges` | yes | Free text that **starts with `D1`** (a schema design) **or `D3`** (an output document). Decides the gate and the default "return to" stage |
| `step` | no | Lifecycle step, shown in the dashboard |
| `frozen` | yes, must be `true` | A scorecard that is not frozen is refused: the target must not move |
| `approval` | no | Who approved it and when. If it contains "pending" or "draft", every report carries a warning that the verdict is provisional |
| `thresholds` | no | `accept` (default 90) and `refine` (default 75). `refine` must be lower than `accept` |
| `artifact` | yes | Which sheets the agent reads (next section) |
| `dimensions` | yes | At least one (see below) |

## Which sheets the agent reads

```yaml
artifact:
  sheets:                       # what is judged (raters see these, and may cite cells in them)
    - name: Tree
      header_row: 1             # row that holds the column titles (default 1)
      columns: [Path id, Name, Definition]   # optional: raters see only these columns
    - Allowed values            # a plain string means header_row 1, all columns
  context_sheets:               # reference material raters may read and cite (the playbook, say)
    - { name: Stage 1 steps, header_row: 4 }
```

- `sheets` and `context_sheets` are what the **raters** are sent. Raters may cite only cells in these sheets.
- `columns` limits what raters see, by header title. **Use it.** Smaller prompts are cheaper, faster and fit
  providers with low token limits. Code checks are not affected: they read the whole workbook.
- A sheet that is **not** listed can still be used by a code check (for example a lookup table), but raters never see it.
- A header row is used to find columns by title. Duplicate titles become `Title`, `Title #2`.
- A sheet or column that does not exist is refused up front with a message listing what does exist.

## Dimensions

Each dimension says **who measures it** with `measured_by`:

| `measured_by` | Measured by | Needs | Notes |
|---|---|---|---|
| `code` | A built-in check | `check` | Exact. Use for anything countable |
| `raters` | The three models, 0-5 against your anchors | `anchors` for 0, 1, 2, 3, 4, 5 | Each score must cite a real cell |
| `human` | A person | `needs` (what must be supplied) | Not measurable by an agent; blocks green until supplied |

If `measured_by` is left out: a dimension with a `check` is `code`, `measurable_by_agent: false` (the PDF's
spelling) means `human`, and anything else is `raters`.

| Field | Meaning |
|---|---|
| `id` | Letters, digits, `-` or `_`. Unique within the scorecard |
| `name` | Display name |
| `weight` | A positive number. Weights need not add to 100; the score is normalised over the dimensions that count |
| `critical` | `true` = a critical gate: must score **4 or more**, or the verdict cannot be green |
| `description`, `measure` | Optional text shown to raters (and in reports) |
| `anchors` | Rater dimensions: what each score 0-5 means, all six required |
| `check` | Code dimensions: `id`, `params`, `bands`, optional `fix` |
| `needs` | Human dimensions: what the person must provide |
| `return_to` | Which stage a finding on this dimension sends the author back to: `Discover`, `Define`, `Generate`, `Analyse`, `Validate` or `Refine`. Default `Define` for D1, `Generate` for D3 |

## Built-in checks

Each check answers "**how many of these rows are right?**" and returns a pass ratio. Every check names its
`sheet` and `column` by title. Most accept an optional `where` filter.

```yaml
where: { column: Level, equals: 3 }      # only rows whose Level is 3
where: { column: Used by id, not_blank: true }
```

| Check | Passes when | Params |
|---|---|---|
| `max_value` | the numeric value is at most `max` (non-numbers fail) | `sheet`, `column`, `max`, `where?` |
| `column_filled` | the cell is not blank, and matches `pattern` if given | `sheet`, `column`, `pattern?` (regular expression), `where?` |
| `unique` | the value appears once (blank values are ignored; every row in a duplicate fails) | `sheet`, `column`, `where?` |
| `any_filled` | at least one of the listed columns is filled | `sheet`, `columns[]`, `where?` |
| `list_refs_resolve` | every `list: Name` reference names a list that exists **exactly** (a rule glued onto the name fails) | `sheet`, `column`, `prefix?` (default `list:`), `lists_sheet`, `lists_column`, `where?` |
| `lists_referenced` | every defined list is used by at least one reference | `sheet`, `column`, `prefix?`, `lists_sheet`, `lists_column` |
| `values_in_list` | every value is a member of a named allowed list (blanks ignored) | `sheet`, `column`, `lists_sheet`, `lists_name_column`, `lists_value_column`, `list`, `where?` |
| `value_not_in` | the value is not one of `forbidden` (case-insensitive); blank also fails unless `blank_fails: false` | `sheet`, `column`, `forbidden[]`, `blank_fails?`, `where?` |
| `row_count_at_least` | the sheet has at least `min` rows (partial credit by ratio) | `sheet`, `min`, `where?` |

Rows that are completely empty are not counted as records. If a check cannot run (a column is missing, a list has
no values), the dimension becomes **unscored** (counts as 0) and a HIGH finding says why. It never crashes the run.

Failing cells are listed in the finding (up to 25), so the author can go straight to them.

## Bands: ratio to score

For a code dimension, the check's pass ratio (passed ÷ total) is turned into 0-5 by `bands`. The first band, from
the highest `min` down, whose `min` the ratio reaches gives the score; no band reached gives 0.

```yaml
bands:
  - { min: 1.00, score: 5 }
  - { min: 0.97, score: 4 }
  - { min: 0.90, score: 3 }
  - { min: 0.75, score: 2 }
  - { min: 0.01, score: 1 }
```

| Pass ratio | Score |
|---|---|
| 1.00 | 5 |
| 0.97 to 0.99 | 4 |
| 0.90 to 0.96 | 3 |
| 0.75 to 0.89 | 2 |
| 0.01 to 0.74 | 1 |
| 0 | 0 (no band reached) |

For a structural rule that is either kept or broken (tree depth, duplicate ids) use two bands only,
`{min: 1, score: 5}` and `{min: 0.01, score: 1}`, so a single violation fails a critical gate. YAML anchors let you
define a band set once and reuse it:

```yaml
x-bands: &strict [{ min: 1.0, score: 5 }, { min: 0.97, score: 4 }, { min: 0.01, score: 1 }]
# ...
        bands: *strict
```

## Rules the parser enforces

A scorecard that breaks these is rejected with a message naming the file and the field:

- the YAML or JSON must parse, and match the format (unknown keys such as `x-bands` are ignored)
- `frozen` must be `true` (checked when you submit)
- `judges` must start with `D1` or `D3`
- dimension ids are unique; a `raters` dimension has all six anchors; a `code` dimension has a `check`
- `thresholds.refine` is below `thresholds.accept`
- every sheet and column named exists in the workbook (checked on submission, before any model is called)

The scorecard's **hash** (shown in every report) is the SHA-256 of its canonical parsed form, so reformatting the
file does not change it, but changing a weight, anchor or threshold does.

## Tips

- **Quote YAML values that contain `: `** (a colon and a space), for example `measure: 'References written as "list: Name"'`.
  Otherwise YAML reads it as a nested mapping and rejects the file. The error message says which line.
- Put everything countable in code. Use raters only for judgement, and keep their anchors concrete and distinguishable.
- Give every critical rater dimension anchors where **4** means "good, with one minor gap", because 4 is the gate.
- Keep the rater prompt small with `columns` (a 169-node schema plus 194 allowed values is about 13,000 tokens).
- Treat a scorecard like code: version it, review it, freeze it, then do not edit it. Change means a new `version`.
