"""Build the eight-section evaluation report (Agentic Roadmap slide 11) and render it as JSON, HTML and Markdown.

Sections: 1 Header, 2 Verdict, 3 Dimension scores, 4 Strengths, 5 Gaps and findings,
6 Rater agreement, 7 Not measurable here, 8 Path to green.
"""
from __future__ import annotations

import html
import json
from typing import Optional

SCHEMA = "evaluation-report/1.0"
SECTION_TITLES = {
    1: "Header",
    2: "Verdict",
    3: "Dimension scores",
    4: "Strengths",
    5: "Gaps and findings",
    6: "Rater agreement",
    7: "Not measurable here",
    8: "Path to green",
}


def score_class(score: Optional[int]) -> str:
    if score is None:
        return "na"
    if score >= 4:
        return "green"
    if score >= 2:
        return "amber"
    return "red"


def verdict_label(verdict: str, final: bool) -> str:
    # Only a GREEN is held back by missing evidence; an amber or red stands as it is.
    return f"{verdict} (provisional)" if verdict == "GREEN" and not final else verdict


def to_json(report: dict) -> str:
    return json.dumps(report, indent=2, ensure_ascii=False)


# =========================================================================== HTML
CSS = """
:root{--bg:#f6f7f9;--card:#fff;--ink:#14213d;--muted:#5b6475;--line:#e3e6ec;
--green:#15803d;--green-bg:#dcfce7;--amber:#b45309;--amber-bg:#fef3c7;--red:#b91c1c;--red-bg:#fee2e2;
--na:#475569;--na-bg:#e2e8f0;--accent:#1d4ed8}
@media (prefers-color-scheme:dark){:root{--bg:#0f172a;--card:#1e293b;--ink:#e5e9f2;--muted:#9aa5b8;--line:#334155;
--green:#4ade80;--green-bg:#14532d;--amber:#fbbf24;--amber-bg:#4a3a0a;--red:#f87171;--red-bg:#5a1a1a;
--na:#cbd5e1;--na-bg:#334155;--accent:#93c5fd}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:1.5rem;margin:0 0 4px}h2{font-size:1.1rem;margin:0 0 12px}
.sub{color:var(--muted);margin:0 0 20px}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:0 0 16px}
.secno{display:inline-block;min-width:1.6em;color:var(--accent);font-weight:700}
.banner{display:flex;flex-wrap:wrap;align-items:center;gap:20px;border-radius:12px;padding:18px 22px;margin:0 0 16px;border:2px solid}
.banner.green{background:var(--green-bg);border-color:var(--green);color:var(--green)}
.banner.amber{background:var(--amber-bg);border-color:var(--amber);color:var(--amber)}
.banner.red{background:var(--red-bg);border-color:var(--red);color:var(--red)}
.banner .big{font-size:2.2rem;font-weight:800;line-height:1}
.banner .score{font-size:1.6rem;font-weight:700}
.banner small{display:block;font-weight:500;opacity:.9}
.pill,.chip{display:inline-block;border-radius:999px;padding:1px 10px;font-weight:600;font-size:.82rem;white-space:nowrap}
.chip{min-width:2.2em;text-align:center;padding:1px 8px}
.green{background:var(--green-bg);color:var(--green)}.amber{background:var(--amber-bg);color:var(--amber)}
.red{background:var(--red-bg);color:var(--red)}.na{background:var(--na-bg);color:var(--na)}
.banner.green,.banner.amber,.banner.red{background-clip:padding-box}
table{border-collapse:collapse;width:100%;font-size:.9rem}
th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-size:.74rem;text-transform:uppercase;letter-spacing:.04em}
.wrap{overflow-x:auto}.muted{color:var(--muted)}.mono{font-family:ui-monospace,Consolas,monospace;font-size:.82rem}
dl.kv{display:grid;grid-template-columns:200px 1fr;gap:6px 16px;margin:0}dl.kv dt{color:var(--muted)}dl.kv dd{margin:0;word-break:break-word}
.gates{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 0}
ul{margin:6px 0 0;padding-left:20px}
details{margin-top:4px}summary{cursor:pointer;color:var(--accent);font-size:.82rem}
.group td{background:var(--bg);font-weight:700;color:var(--muted);font-size:.78rem;text-transform:uppercase}
.warn{border-left:4px solid var(--amber);background:var(--amber-bg);color:var(--amber);padding:8px 12px;border-radius:6px;margin:0 0 12px}
.q{font-style:italic;color:var(--muted)}
@media (max-width:640px){dl.kv{grid-template-columns:1fr}}
"""


def _e(x) -> str:
    return html.escape("" if x is None else str(x))


def _chip(score: Optional[int], text: Optional[str] = None) -> str:
    label = text if text is not None else ("–" if score is None else str(score))
    return f'<span class="chip {score_class(score)}">{_e(label)}</span>'


def _sev(sev: str) -> str:
    cls = {"HIGH": "red", "MEDIUM": "amber", "LOW": "na"}[sev]
    return f'<span class="pill {cls}">{_e(sev.title())} risk</span>'


def _gate(result: str) -> str:
    cls = {"PASS": "green", "FAIL": "red", "PENDING": "na"}[result]
    return f'<span class="pill {cls}">{_e(result)}</span>'


def render_html(r: dict) -> str:
    h, v = r["header"], r["verdict"]
    vcls = {"GREEN": "green", "AMBER": "amber", "RED": "red"}[v["decision"]]
    out: list[str] = []
    out.append(f"<!doctype html><html lang='en'><head><meta charset='utf-8'>"
               f"<meta name='viewport' content='width=device-width,initial-scale=1'>"
               f"<title>Evaluation report {_e(h['run_id'])}</title><style>{CSS}</style></head><body><main>")
    out.append(f"<h1>Evaluation report</h1><p class='sub'>{_e(h['artifact']['id'])} against "
               f"{_e(h['scorecard']['id'])} v{_e(h['scorecard']['version'])} · run {_e(h['run_id'])}</p>")
    if h.get("mock"):
        out.append("<div class='warn'><strong>MOCK RUN.</strong> No real model was called. Scores are placeholders "
                   "and mean nothing. Run without --mock for a real evaluation.</div>")

    # 1 Header
    out.append(f"<section><h2><span class='secno'>1</span>{SECTION_TITLES[1]}</h2><dl class='kv'>")
    a, sc = h["artifact"], h["scorecard"]
    out.append(f"<dt>Artifact</dt><dd>{_e(a['id'])} · version {_e(a['version'] or 'not stated')} · "
               f"<span class='mono'>sha256 {_e(a['sha256'][:16])}…</span></dd>")
    out.append(f"<dt>Scorecard</dt><dd>{_e(sc['id'])} · version {_e(sc['version'])} · "
               f"<span class='mono'>sha256 {_e(sc['sha256'][:16])}…</span></dd>")
    for s in h["sources"]:
        out.append(f"<dt>Source document</dt><dd>{_e(s['label'])} · <span class='mono'>sha256 {_e(s['sha256'][:16])}…</span></dd>")
    for rt in h["raters"]:
        status = "ran" if rt["ok"] else f"FAILED: {rt['error']}"
        out.append(f"<dt>Rater {_e(rt['id'])}</dt><dd>{_e(rt['model'])} ({_e(rt['family'])}) · served as "
                   f"{_e(rt['model_version'] or '–')} · {_e(status)}</dd>")
    c = h["consolidator"]
    out.append(f"<dt>Consolidator</dt><dd>{_e(c['model'])} · served as {_e(c['model_version'] or '–')}"
               f"{' · ' + _e(c['error']) if c.get('error') else ''}</dd>")
    out.append(f"<dt>Date and run ID</dt><dd>{_e(h['date'])} · {_e(h['run_id'])}</dd></dl></section>")

    # 2 Verdict
    label = verdict_label(v["decision"], v["final"])
    out.append(f"<div class='banner {vcls}'><div><div class='big'>{_e(label)}</div>"
               f"<small>Decision</small></div><div><div class='score'>{v['weighted_score']:g} / 100</div>"
               f"<small>Weighted score over {v['measured_weight']:g} of 100 weight scored</small></div>"
               f"<div><div class='score'>{v['open_high_findings']}</div><small>HIGH findings open</small></div></div>")
    out.append(f"<section><h2><span class='secno'>2</span>{SECTION_TITLES[2]}</h2>")
    out.append(f"<p>Green needs {v['thresholds']['green']:g} or more and every critical gate at "
               f"{v['thresholds']['critical_min']} or more. Amber is {v['thresholds']['amber']:g} to "
               f"{v['thresholds']['green'] - 0.1:g}, or a critical gate below {v['thresholds']['critical_min']}. "
               f"Red is below {v['thresholds']['amber']:g}.</p><ul>")
    for reason in v["reasons"]:
        out.append(f"<li>{_e(reason)}</li>")
    out.append("</ul><div class='gates'>")
    for g in v["critical_gates"]:
        out.append(f"<span>{_gate(g['result'])} {_e(g['dimension_id'])} {_e(g['name'])} "
                   f"({_e('–' if g['score'] is None else g['score'])})</span>")
    out.append("</div></section>")

    # 3 Dimension scores
    out.append(f"<section><h2><span class='secno'>3</span>{SECTION_TITLES[3]}</h2><div class='wrap'><table><thead><tr>"
               "<th>ID</th><th>Dimension</th><th>Weight</th><th>Who scored</th><th>Rater scores</th>"
               "<th>Consolidated</th><th>Spread</th></tr></thead><tbody>")
    group = None
    for d in r["dimension_scores"]:
        if d["group"] != group:
            group = d["group"]
            out.append(f"<tr class='group'><td colspan='7'>{_e(group)}</td></tr>")
        crit = " <span class='pill amber'>critical</span>" if d["critical"] else ""
        if d["evaluator"] == "llm":
            raters = " ".join(f"{_e(k)} {_chip(s)}" for k, s in d["rater_scores"].items())
        elif d["evaluator"] == "code":
            raters = "<span class='muted'>deterministic checks</span>"
        else:
            raters = "<span class='muted'>person</span>"
        if d["spread"] is None:
            spread = ""
        else:
            scls = "red" if d["spread"] > 1 else ("amber" if d["spread"] == 1 else "green")
            spread = f'<span class="chip {scls}">{d["spread"]}</span>'
        cons = _chip(d["score"], None if d["status"] == "scored" else {"pending_human": "pending", "not_measurable": "n/a"}[d["status"]])
        detail = ""
        extra = list(d["detail"])
        if d["rationale"]:
            extra.insert(0, d["rationale"])
        if d["flagged_for_person"]:
            extra.insert(0, "FLAGGED FOR A PERSON")
        if extra:
            detail = "<details><summary>details</summary><ul>" + "".join(f"<li>{_e(x)}</li>" for x in extra) + "</ul></details>"
        out.append(f"<tr><td class='mono'>{_e(d['id'])}</td><td>{_e(d['name'])}{crit}{detail}</td>"
                   f"<td>{d['weight']:g}</td><td>{_e(d['evaluator'])}</td><td>{raters}</td><td>{cons}</td><td>{spread}</td></tr>")
    out.append("</tbody></table></div></section>")

    # 4 Strengths
    out.append(f"<section><h2><span class='secno'>4</span>{SECTION_TITLES[4]}</h2>")
    if r["strengths"]:
        out.append("<ul>")
        for s in r["strengths"]:
            q = f" <span class='q'>“{_e(s['quote'])}”</span>" if s["quote"] else ""
            out.append(f"<li><strong>{_e(s['dimension_id'])} {_e(s['dimension_name'])}.</strong> {_e(s['text'])}"
                       f" <span class='muted'>{_e(s['location'])}</span>{q}</li>")
        out.append("</ul>")
    else:
        out.append("<p class='muted'>No strengths with verifiable evidence were reported.</p>")
    out.append("</section>")

    # 5 Findings
    out.append(f"<section><h2><span class='secno'>5</span>{SECTION_TITLES[5]}</h2>")
    if r["findings"]:
        out.append("<div class='wrap'><table><thead><tr><th>ID</th><th>Severity</th><th>Dimension</th>"
                   "<th>Finding and location</th><th>Recommended fix</th><th>Return to</th></tr></thead><tbody>")
        for f in r["findings"]:
            q = f"<div class='q'>“{_e(f['quote'])}”</div>" if f["quote"] else ""
            unv = "" if f["verified"] else " <span class='pill na'>quote unverified</span>"
            by = f"<div class='muted'>raised by {_e(', '.join(f['raised_by']))}</div>" if f["raised_by"] else ""
            out.append(f"<tr><td class='mono'>{_e(f['id'])}</td><td>{_sev(f['severity'])}</td>"
                       f"<td>{_e(f['dimension_id'])} {_e(f['dimension_name'])}</td>"
                       f"<td>{_e(f['text'])}{unv}<div class='muted'>{_e(f['location'])}</div>{q}{by}</td>"
                       f"<td>{_e(f['fix'])}</td><td>{_e(f['return_to'])}</td></tr>")
        out.append("</tbody></table></div>")
    else:
        out.append("<p class='muted'>No findings.</p>")
    out.append("</section>")

    # 6 Rater agreement
    ag = r["rater_agreement"]
    out.append(f"<section><h2><span class='secno'>6</span>{SECTION_TITLES[6]}</h2><dl class='kv'>"
               f"<dt>Raters that produced a result</dt><dd>{ag['raters_ok']} of {ag['raters_total']}</dd>"
               f"<dt>Average rater spread</dt><dd>{_e(ag['average_spread'])}</dd>"
               f"<dt>Dimensions with spread above 1</dt><dd>{len(ag['disagreements'])}</dd>"
               f"<dt>Flagged for a person</dt><dd>{len(ag['flagged_for_person'])}</dd></dl>")
    for rr in ag["per_rater"]:
        out.append(f"<p class='muted'>Rater {_e(rr['id'])}: {rr['discarded_scores']} score(s) and "
                   f"{rr['discarded_evidence']} quote(s) discarded as unverifiable"
                   f"{'; missing ' + _e(', '.join(rr['missing'])) if rr['missing'] else ''}.</p>")
    if ag["disagreements"] or ag["flagged_for_person"]:
        out.append("<div class='wrap'><table><thead><tr><th>Dimension</th><th>Rater scores</th><th>Consolidated</th>"
                   "<th>How it was settled</th></tr></thead><tbody>")
        for row in ag["disagreements"] + [x for x in ag["flagged_for_person"] if x not in ag["disagreements"]]:
            scores = " ".join(f"{_e(k)} {_chip(s)}" for k, s in row["rater_scores"].items())
            out.append(f"<tr><td>{_e(row['dimension_id'])} {_e(row['name'])}</td><td>{scores}</td>"
                       f"<td>{_chip(row['score'])}</td><td>{_e(row['basis'])}: {_e(row['rationale'])}"
                       f"{' <span class=pill na>flagged for a person</span>' if row['flagged'] else ''}</td></tr>")
        out.append("</tbody></table></div>")
    for note in ag["notes"]:
        out.append(f"<p class='muted'>{_e(note)}</p>")
    out.append("</section>")

    # 7 Not measurable
    out.append(f"<section><h2><span class='secno'>7</span>{SECTION_TITLES[7]}</h2>")
    if r["not_measurable_here"]:
        out.append("<ul>")
        for n in r["not_measurable_here"]:
            out.append(f"<li><strong>{_e(n['dimension_id'])} {_e(n['name'])}</strong> "
                       f"(weight {n['weight']:g}{', critical' if n['critical'] else ''}): {_e(n['why'])}</li>")
        out.append("</ul>")
    else:
        out.append("<p class='muted'>Everything in the scorecard was measured.</p>")
    out.append("</section>")

    # 8 Path to green
    out.append(f"<section><h2><span class='secno'>8</span>{SECTION_TITLES[8]}</h2>")
    if r["path_to_green"]:
        out.append("<p class='muted'>The smallest set of fixes, in priority order. The projected score assumes each "
                   "fix lifts its dimension to the target shown.</p><ol>")
        for s in r["path_to_green"]:
            tgt = f" → target {s['target_score']}" if s["target_score"] else ""
            ids = f" <span class='muted'>({_e(', '.join(s['finding_ids']))})</span>" if s["finding_ids"] else ""
            out.append(f"<li>{_e(s['action'])}{ids}{tgt} · projected score "
                       f"<strong>{s['projected_score']:g}</strong></li>")
        out.append("</ol>")
    else:
        out.append("<p class='muted'>Nothing further is needed to reach green.</p>")
    out.append("</section></main></body></html>")
    return "".join(out)


# =========================================================================== Markdown
def _md_score(score: Optional[int]) -> str:
    icon = {"green": "🟢", "amber": "🟡", "red": "🔴", "na": "⚪"}[score_class(score)]
    return f"{icon} {'–' if score is None else score}"


def _md_cell(x) -> str:
    return str(x).replace("|", "\\|").replace("\n", " ")


def render_md(r: dict) -> str:
    h, v = r["header"], r["verdict"]
    icon = {"GREEN": "🟢", "AMBER": "🟡", "RED": "🔴"}[v["decision"]]
    L: list[str] = []
    L.append(f"# Evaluation report: {h['artifact']['id']}\n")
    if h.get("mock"):
        L.append("> **MOCK RUN.** No real model was called. Scores are placeholders.\n")
    L.append("## 1. Header\n")
    L.append(f"- **Artifact:** {h['artifact']['id']} · version {h['artifact']['version'] or 'not stated'} · sha256 `{h['artifact']['sha256']}`")
    L.append(f"- **Scorecard:** {h['scorecard']['id']} v{h['scorecard']['version']} · sha256 `{h['scorecard']['sha256']}`")
    for s in h["sources"]:
        L.append(f"- **Source:** {s['label']} · sha256 `{s['sha256']}`")
    for rt in h["raters"]:
        L.append(f"- **Rater {rt['id']}:** {rt['model']} ({rt['family']}), served as {rt['model_version'] or '–'}, "
                 f"{'ran' if rt['ok'] else 'FAILED: ' + rt['error']}")
    L.append(f"- **Consolidator:** {h['consolidator']['model']}, served as {h['consolidator']['model_version'] or '–'}")
    L.append(f"- **Date and run ID:** {h['date']} · {h['run_id']}\n")
    L.append("## 2. Verdict\n")
    L.append(f"### {icon} {verdict_label(v['decision'], v['final'])} · {v['weighted_score']:g} / 100\n")
    L.append(f"Scored weight: {v['measured_weight']:g} of 100. HIGH findings open: {v['open_high_findings']}.\n")
    for reason in v["reasons"]:
        L.append(f"- {reason}")
    L.append("\n| Critical gate | Score | Result |\n|---|---|---|")
    for g in v["critical_gates"]:
        res = {"PASS": "🟢 PASS", "FAIL": "🔴 FAIL", "PENDING": "⚪ PENDING"}[g["result"]]
        L.append(f"| {g['dimension_id']} {g['name']} | {'–' if g['score'] is None else g['score']} | {res} |")
    L.append("\n## 3. Dimension scores\n")
    L.append("| ID | Dimension | Weight | Scored by | Rater scores | Consolidated | Spread |\n|---|---|---|---|---|---|---|")
    for d in r["dimension_scores"]:
        raters = ", ".join(f"{k} {_md_score(s)}" for k, s in d["rater_scores"].items()) if d["evaluator"] == "llm" else d["evaluator"]
        cons = _md_score(d["score"]) if d["status"] == "scored" else {"pending_human": "⚪ pending", "not_measurable": "⚪ n/a"}[d["status"]]
        crit = " (critical)" if d["critical"] else ""
        spread = "" if d["spread"] is None else d["spread"]
        L.append(f"| {d['id']} | {_md_cell(d['name'])}{crit} | {d['weight']:g} | {d['evaluator']} | {raters} | {cons} | {spread} |")
    L.append("\n## 4. Strengths\n")
    for s in r["strengths"] or []:
        q = f' “{s["quote"]}”' if s["quote"] else ""
        L.append(f"- **{s['dimension_id']} {s['dimension_name']}.** {s['text']} ({s['location']}){q}")
    if not r["strengths"]:
        L.append("None reported with verifiable evidence.")
    L.append("\n## 5. Gaps and findings\n")
    if r["findings"]:
        L.append("| ID | Severity | Dimension | Finding and location | Fix | Return to |\n|---|---|---|---|---|---|")
        for f in r["findings"]:
            sev = {"HIGH": "🔴 High risk", "MEDIUM": "🟡 Medium risk", "LOW": "⚪ Low risk"}[f["severity"]]
            loc = f" ({f['location']})" if f["location"] else ""
            L.append(f"| {f['id']} | {sev} | {f['dimension_id']} | {_md_cell(f['text'])}{_md_cell(loc)} | {_md_cell(f['fix'])} | {_md_cell(f['return_to'])} |")
    else:
        L.append("No findings.")
    ag = r["rater_agreement"]
    L.append("\n## 6. Rater agreement\n")
    L.append(f"- Raters with a result: {ag['raters_ok']} of {ag['raters_total']}; average spread {ag['average_spread']}; "
             f"spread above 1 on {len(ag['disagreements'])} dimension(s); flagged for a person: {len(ag['flagged_for_person'])}.")
    for rr in ag["per_rater"]:
        L.append(f"- Rater {rr['id']}: {rr['discarded_scores']} score(s) and {rr['discarded_evidence']} quote(s) discarded as unverifiable.")
    for row in ag["disagreements"]:
        scores = ", ".join(f"{k} {s}" for k, s in row["rater_scores"].items())
        L.append(f"- {row['dimension_id']} {row['name']}: raters {scores}; consolidated {row['score']} ({row['basis']}). {row['rationale']}")
    for note in ag["notes"]:
        L.append(f"- {note}")
    L.append("\n## 7. Not measurable here\n")
    for n in r["not_measurable_here"] or []:
        L.append(f"- **{n['dimension_id']} {n['name']}** (weight {n['weight']:g}{', critical' if n['critical'] else ''}): {n['why']}")
    if not r["not_measurable_here"]:
        L.append("Everything was measured.")
    L.append("\n## 8. Path to green\n")
    for s in r["path_to_green"] or []:
        L.append(f"{s['priority']}. {s['action']} → projected score **{s['projected_score']:g}**")
    if not r["path_to_green"]:
        L.append("Nothing further is needed to reach green.")
    return "\n".join(L) + "\n"


# =========================================================================== terminal
def terminal_summary(r: dict, out_dir: str) -> str:
    v = r["verdict"]
    code = {"GREEN": "\033[32m", "AMBER": "\033[33m", "RED": "\033[31m"}[v["decision"]]
    reset = "\033[0m"
    lines = [f"{code}{verdict_label(v['decision'], v['final'])}{reset}  weighted score {v['weighted_score']:g} / 100 "
             f"(scored weight {v['measured_weight']:g})"]
    for g in v["critical_gates"]:
        c = {"PASS": "\033[32m", "FAIL": "\033[31m", "PENDING": "\033[90m"}[g["result"]]
        lines.append(f"  {c}{g['result']:<7}{reset} {g['dimension_id']} {g['name']} ({'–' if g['score'] is None else g['score']})")
    counts = {s: sum(1 for f in r["findings"] if f["severity"] == s) for s in ("HIGH", "MEDIUM", "LOW")}
    lines.append(f"  findings: {counts['HIGH']} high, {counts['MEDIUM']} medium, {counts['LOW']} low")
    lines.append(f"  report: {out_dir}")
    return "\n".join(lines)
