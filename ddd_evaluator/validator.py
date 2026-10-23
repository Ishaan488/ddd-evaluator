"""Check rater output in code before anyone relies on it.

Rule (slide 13, Evidence): every score and finding cites a location in the artifact.
Unsupported claims are discarded. Here that means a quote must really occur in the
artifact or the source documents.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from .models import DimScore, Evidence, Finding, Dimension

_WS = re.compile(r"\s+")
_FILLER = re.compile(r"[‘’“”\"'`]")


def normalise(text: str) -> str:
    return _WS.sub(" ", _FILLER.sub("", text)).strip().lower()


def quote_found(quote: str, corpus_norm: str) -> bool:
    """A quote counts if every fragment (split on an ellipsis) occurs in the corpus."""
    quote = quote.strip()
    if len(quote) < 6:
        return False
    fragments = [normalise(p) for p in re.split(r"…|\.\.\.", quote)]
    fragments = [f for f in fragments if len(f) >= 6]
    return bool(fragments) and all(f in corpus_norm for f in fragments)


@dataclass
class ValidDim:
    dimension_id: str
    score: Optional[int]
    not_measurable: bool
    rationale: str
    evidence: list[Evidence]
    findings: list[Finding]
    discarded_evidence: int = 0
    unverified_findings: set[int] = field(default_factory=set)  # indexes into findings
    note: str = ""


@dataclass
class ValidatedRater:
    rater_id: str
    dims: dict[str, ValidDim]
    missing: list[str]
    discarded_scores: list[str]
    discarded_evidence: int

    def usable_score(self, dim_id: str) -> Optional[int]:
        d = self.dims.get(dim_id)
        return d.score if d is not None and not d.not_measurable else None


def validate_rater(rater_id: str, dims: list[DimScore], expected: list[Dimension], corpus: str) -> ValidatedRater:
    corpus_norm = normalise(corpus)
    out: dict[str, ValidDim] = {}
    discarded_scores: list[str] = []
    total_discarded = 0
    by_id = {d.dimension_id: d for d in dims}
    for dim in expected:
        raw = by_id.get(dim.id)
        if raw is None:
            continue
        good = [e for e in raw.evidence if quote_found(e.quote, corpus_norm)]
        dropped = len(raw.evidence) - len(good)
        total_discarded += dropped
        score, note = raw.score, ""
        if raw.not_measurable:
            score = None
        elif score is None:
            note = "no score given"
        elif score >= 2 and not good:
            score, note = None, "score discarded: no quote could be found in the artifact or sources"
            discarded_scores.append(dim.id)
        elif score <= 1 and not good and not raw.rationale.strip():
            score, note = None, "score discarded: no evidence and no rationale for the absence"
            discarded_scores.append(dim.id)
        findings: list[Finding] = []
        unverified: set[int] = set()
        for f in raw.findings:
            f = f.model_copy()
            verified = f.absence or quote_found(f.quote, corpus_norm)
            if not verified:
                unverified.add(len(findings))
                if f.severity == "HIGH":
                    f.severity = "MEDIUM"  # a HIGH finding must be backed by a real quote or an absence
                elif f.severity == "MEDIUM":
                    f.severity = "LOW"
            findings.append(f)
        out[dim.id] = ValidDim(dim.id, score, raw.not_measurable, raw.rationale, good, findings,
                               dropped, unverified, note)
    missing = [d.id for d in expected if d.id not in out]
    return ValidatedRater(rater_id, out, missing, discarded_scores, total_discarded)


def rater_payload(v: ValidatedRater) -> dict:
    """What the consolidator gets to see: only what survived validation."""
    return {"dimensions": [
        {
            "dimension_id": d.dimension_id,
            "score": d.score,
            "not_measurable": d.not_measurable,
            "rationale": d.rationale,
            "evidence": [e.model_dump() for e in d.evidence],
            "findings": [f.model_dump() for f in d.findings],
        }
        for d in v.dims.values()
    ]}
