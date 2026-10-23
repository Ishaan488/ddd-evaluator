"""Data models: the scorecard, rater and consolidator outputs, and the final report pieces."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

Severity = Literal["HIGH", "MEDIUM", "LOW"]
EvaluatorKind = Literal["code", "llm", "human"]
Verdict = Literal["GREEN", "AMBER", "RED"]
GateResult = Literal["PASS", "FAIL", "PENDING"]

SEVERITY_ORDER = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}


# --------------------------------------------------------------------------- scorecard
class Thresholds(BaseModel):
    green: float = 90
    amber: float = 75
    critical_min: int = 4


class Dimension(BaseModel):
    id: str
    name: str
    group: str = ""
    weight: float = Field(gt=0)
    critical: bool = False
    evaluator: EvaluatorKind
    measure: str = ""
    guidance: str = ""
    look_for: list[str] = Field(default_factory=list)
    checks: list[str] = Field(default_factory=list)
    traces_to: list[str] = Field(default_factory=list)
    anchors: dict[int, str]

    @field_validator("anchors")
    @classmethod
    def _anchors_complete(cls, v: dict[int, str]) -> dict[int, str]:
        missing = [n for n in range(6) if n not in v]
        if missing:
            raise ValueError(f"anchors must define scores 0 to 5, missing {missing}")
        return v

    @model_validator(mode="after")
    def _code_needs_checks(self) -> "Dimension":
        if self.evaluator == "code" and not self.checks:
            raise ValueError(f"code dimension {self.id} lists no checks")
        return self


class Scorecard(BaseModel):
    id: str
    version: str
    judges: str = ""
    frozen: bool = False
    thresholds: Thresholds = Field(default_factory=Thresholds)
    dimensions: list[Dimension]

    @model_validator(mode="after")
    def _consistent(self) -> "Scorecard":
        ids = [d.id for d in self.dimensions]
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        if dupes:
            raise ValueError(f"duplicate dimension ids: {dupes}")
        total = sum(d.weight for d in self.dimensions)
        if abs(total - 100) > 0.01:
            raise ValueError(f"dimension weights add up to {total}, not 100")
        return self

    def by_kind(self, kind: EvaluatorKind) -> list[Dimension]:
        return [d for d in self.dimensions if d.evaluator == kind]

    def get(self, dim_id: str) -> Dimension:
        for d in self.dimensions:
            if d.id == dim_id:
                return d
        raise KeyError(dim_id)


# --------------------------------------------------------------------------- rater output
class Evidence(BaseModel):
    location: str = ""
    quote: str = ""


class Finding(BaseModel):
    severity: Severity
    text: str
    fix: str = ""
    location: str = ""
    quote: str = ""
    absence: bool = False  # true when the problem is something missing, so there is nothing to quote
    return_to: str = ""


class DimScore(BaseModel):
    dimension_id: str
    score: Optional[int] = None
    not_measurable: bool = False
    rationale: str = ""
    evidence: list[Evidence] = Field(default_factory=list)
    findings: list[Finding] = Field(default_factory=list)

    @field_validator("score", mode="before")
    @classmethod
    def _coerce_score(cls, v):
        if v is None or v == "":
            return None
        v = int(round(float(v)))
        if not 0 <= v <= 5:
            raise ValueError("score must be between 0 and 5")
        return v


class RaterResult(BaseModel):
    dimensions: list[DimScore]


# --------------------------------------------------------------------------- consolidator output
class ConsDim(BaseModel):
    dimension_id: str
    score: Optional[int] = None
    not_measurable: bool = False
    basis: Literal["agreed", "checked", "lower_stands", "single_rater"] = "agreed"
    rationale: str = ""
    flagged_for_person: bool = False

    @field_validator("score", mode="before")
    @classmethod
    def _coerce_score(cls, v):
        if v is None or v == "":
            return None
        v = int(round(float(v)))
        if not 0 <= v <= 5:
            raise ValueError("score must be between 0 and 5")
        return v


class ConsFinding(BaseModel):
    severity: Severity
    dimension_id: str
    text: str
    fix: str = ""
    location: str = ""
    quote: str = ""
    absence: bool = False
    return_to: str = ""
    raised_by: list[str] = Field(default_factory=list)


class ConsStrength(BaseModel):
    dimension_id: str
    text: str
    location: str = ""
    quote: str = ""


class ConsolidatorResult(BaseModel):
    dimensions: list[ConsDim]
    findings: list[ConsFinding] = Field(default_factory=list)
    strengths: list[ConsStrength] = Field(default_factory=list)


# --------------------------------------------------------------------------- final, assembled pieces
class FinalDim(BaseModel):
    id: str
    name: str
    group: str
    weight: float
    critical: bool
    evaluator: EvaluatorKind
    score: Optional[int] = None
    status: Literal["scored", "not_measurable", "pending_human"] = "scored"
    rater_scores: dict[str, Optional[int]] = Field(default_factory=dict)
    spread: Optional[int] = None
    basis: str = ""
    rationale: str = ""
    flagged_for_person: bool = False
    detail: list[str] = Field(default_factory=list)  # code check results or human evidence note


class FinalFinding(BaseModel):
    id: str
    severity: Severity
    dimension_id: str
    dimension_name: str
    text: str
    location: str = ""
    quote: str = ""
    fix: str = ""
    return_to: str = ""
    raised_by: list[str] = Field(default_factory=list)
    verified: bool = True
    origin: Literal["code", "rater"] = "rater"


class FinalStrength(BaseModel):
    dimension_id: str
    dimension_name: str
    text: str
    location: str = ""
    quote: str = ""
