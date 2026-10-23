from pathlib import Path

import openpyxl
import pytest

ROOT = Path(__file__).resolve().parents[1]
SCORECARD = ROOT / "scorecards" / "SC-DISCOVER-D2.xlsx"


def edit_scorecard(tmp_path, mutate, name="edited.xlsx"):
    """Copy the real scorecard workbook, let `mutate(workbook)` change it, and return the new path."""
    wb = openpyxl.load_workbook(SCORECARD)
    mutate(wb)
    out = tmp_path / name
    wb.save(out)
    return out

TREE_HEADER = ["Deliverable", "Section ID", "Section", "Path id", "Level", "Level name", "Name", "Definition",
               "Data type", "Atomic or derived", "Required", "Allowed values", "Example", "Table", "Column"]
REG_HEADER = ["Table", "Column", "Data type", "Required", "Key", "Allowed values", "Used by id", "Sub-parameter",
              "Section ID", "L4 atomic definition"]
ALLOWED_HEADER = ["List", "Value", "Meaning", "Used by sub-parameter", "Section ID"]


def make_workbook(path: Path, *, broken: bool = False) -> Path:
    """A tiny but valid artifact workbook. broken=True plants known defects."""
    wb = openpyxl.Workbook()
    tree = wb.active
    tree.title = "Tree"
    tree.append(TREE_HEADER)
    tree.append(["Step 03", "SEC-01", "Things", "1", 1, "Macro", "Things", "All the things we record.", None, None, None, None, None, "thing", None])
    tree.append(["Step 03", "SEC-01", "Things", "1.1", 2, "Micro", "Identity", "Which thing it is.", None, None, None, None, None, "thing", "(2 columns)"])
    tree.append(["Step 03", "SEC-01", "Things", "1.1.1", 3, "Nano", "Thing id", "One fixed code.", "id", "atomic", "required", "unique, pattern T-nn", "T-01", "thing", "thing_id"])
    tree.append(["Step 03", "SEC-01", "Things", "1.1.2", 3, "Nano", "Kind", "What sort of thing.", "enum", "atomic", "required", "list: Kind", "Cost", "thing", "kind"])
    tree.append(["Step 03", "SEC-01", "Things", "1.1.3", 3, "Nano", "Amount", "How much it costs.", "decimal", "atomic", "conditional",
                 "0 or more" if broken else "0 or more; required when kind is Cost", "10", "thing", "amount"])
    tree.append(["Step 03", "SEC-01", "Things", "1.1.4", 3, "Nano", "Derived from", "Where the amount came from.", "text", "atomic", "optional", "1 to 50 characters", "Volumes", "thing", "derived_from"])
    if broken:
        tree.append(["Step 03", "SEC-01", "Things", "1.1.5", 3, "Nano", "Tags", "", "text", "atomic", "optional", "comma separated names", "a,b", "thing", "tags"])

    reg = wb.create_sheet("Schema register")
    reg.append(REG_HEADER)
    reg.append(["thing", "thing_id", "id", "required", "Primary key", "unique, pattern T-nn", "1.1.1", "Thing id", "SEC-01", "Thing id: one id value, required; rule: unique."])
    reg.append(["thing", "kind", "enum", "required", "", "list: Kind", "1.1.2", "Kind", "SEC-01", "Kind: one enum value, required; rule: list: Kind."])
    reg.append(["thing", "amount", "decimal", "conditional", "", "0 or more" if broken else "0 or more; required when kind is Cost", "1.1.3", "Amount", "SEC-01", "Amount: one decimal value, conditional."])
    reg.append(["thing", "derived_from", "text", "optional", "", "1 to 50 characters", "1.1.4", "Derived from", "SEC-01", "Derived from: one text value, optional; rule: 1 to 50 characters."])
    reg.append(["part", "part_id", "id", "required", "Primary key", "unique, pattern P-nn", "", "Key column, not a parameter", "Key link", "Key link."])
    reg.append(["part", "thing_id", "reference", "required", "Foreign key" if broken else "Foreign key to thing.thing_id", "", "", "Key column, not a parameter", "Key link", "Key link."])
    if broken:
        reg.append(["thing", "tags", "text", "optional", "", "comma separated names", "1.1.5", "Tags", "SEC-01", "Tags: one text value, optional."])

    allowed = wb.create_sheet("Allowed values")
    allowed.append(ALLOWED_HEADER)
    allowed.append(["Kind", "Cost", "Money out.", "1.1.2 Kind", "SEC-01"])
    allowed.append(["Kind", "Income", "Money in.", None, "SEC-01"])
    wb.save(path)
    return path


@pytest.fixture
def workbook(tmp_path):
    return make_workbook(tmp_path / "good.xlsx")


@pytest.fixture
def broken_workbook(tmp_path):
    return make_workbook(tmp_path / "broken.xlsx", broken=True)


@pytest.fixture
def docket(tmp_path):
    p = tmp_path / "docket.md"
    p.write_text("# Problem statement\nThe platform must record every thing with a kind and an amount.\n", encoding="utf-8")
    return p


@pytest.fixture
def config_file(tmp_path):
    p = tmp_path / "config.yaml"
    p.write_text(
        "raters:\n"
        "  - {id: A, family: anthropic, model: model-a}\n"
        "  - {id: B, family: openai, model: model-b}\n"
        "  - {id: C, family: google, model: model-c}\n"
        "consolidator:\n  model: model-d\n",
        encoding="utf-8",
    )
    return p
