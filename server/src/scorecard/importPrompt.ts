import type { DocumentOutline } from './importer.js';

/** Marks the system prompt as a scorecard import, so the mock model can recognise it. */
export const IMPORT_MARKER = 'SCORECARD_IMPORT';

const FORMAT = `{
  "scorecard": {
    "id": "SC-SHORT-ID",
    "name": "Readable name",
    "version": "1.0",
    "judges": "D1 schema design" | "D3 output document",   // must start with D1 or D3
    "step": "optional step label",
    "thresholds": { "accept": 90, "refine": 75 },
    "red_at_or_below": 2,                                   // optional, only if the source says a gate at or below N means red
    "artifact": { "sheets": [ { "name": "Sheet or 'Page 1-170'", "header_row": 1 } ], "context_sheets": [] },
    "dimensions": [
      {
        "id": "G01", "name": "...", "weight": 5, "critical": false,
        "measured_by": "raters" | "human",
        "measure": "the question, in one sentence",
        "anchors": { "0": "...", "1": "...", "2": "...", "3": "...", "4": "...", "5": "..." },   // raters only, all six required
        "needs": "what a person must supply",                                                      // human only
        "return_to": "Discover" | "Define" | "Generate" | "Analyse" | "Validate" | "Refine",
        "reads": ["Page 7-9"],                                                                    // raters only: the pages or sheets it needs, most relevant first
        "criteria": [                                                                              // every criterion of the source dimension
          { "id": "G02-C01", "name": "Field-level source trace", "kind": "counted" },
          { "id": "G04-C04", "name": "Vague-term free", "kind": "counted",
            "check": { "id": "text_terms_absent", "params": { "terms": ["etc", "TBD"] } } }      // optional, see rule 9
        ]
      }
    ]
  },
  "general_anchor": { "0": "...", "1": "...", "2": "...", "3": "...", "4": "...", "5": "..." },   // the source's general anchor, if it has one
  "uncertain": ["each thing you were not sure about, one sentence each"],
  "adjustments": ["each judgement call you made, one sentence each"]
}`;

export const importSystem = (maxPages: number) => `${IMPORT_MARKER}
You convert a scorecard written in any layout into the JSON format below. You are drafting; a person will check every line.

Rules:
1. Copy ids, names, weights, gate (critical) flags and thresholds exactly as the source states them. Never invent a criterion, weight or rule. If something is missing, leave it out and say so in "uncertain".
2. A question judged by reading the document needs its own anchors for 0 to 5, written for THAT question: say what the document would show at each level, in the question's own terms (what is present, what is missing). Use the source's own wording for a criterion where it has it (for example "5 all four; 3 two or three; 1 one"), filling the levels in between. Do NOT paste the same general anchor under every question; use the general anchor only as the fallback, and say so in "uncertain" when you did.
3. A criterion that needs counting, a list a person fills in, an interview or a sign-off is "counted". A criterion a reader scores from the document against anchors (the source may call it "Anchored") is "judged". Never use measured_by "code" on a dimension.
4. Keep one dimension per source dimension, with its source id, name, weight and gate flag, and list EVERY criterion of it under "criteria" with its kind. Do NOT split a dimension and do not leave a counted criterion out: code splits the dimension and shares its weight. Give a dimension anchors whenever it has at least one judged criterion (the source's own, else the general anchor). Set measured_by to "raters" when it has any judged criterion, otherwise "human" with "needs" saying what the person must supply.
5. A dimension the source calls a GATE or critical gets "critical": true. If the source says a gate dimension at or below some score forces a red result, set red_at_or_below.
6. judges is "D1 schema design" when the scorecard judges a schema or design, and "D3 output document" when it judges a produced document.
7. artifact and reads: use only the sheet or page names in the document outline you are given. For a PDF write ranges like "Page 7-9", keep each question to at most ${maxPages} pages in total, and give each question the pages that hold its evidence, most relevant first (use the first lines to choose). For an Excel file use sheet names. If no outline is given, use one sheet named "Sheet1" and say in "uncertain" that it must be set.
8. Say plainly in "uncertain" about anything you guessed, and about any rule in the source that this format cannot hold (for example caps, averages or formulas).
9. A counted criterion may carry a "check" only when counting words or identifiers in the document's text settles it exactly. Use one of: "text_terms_absent" (params: terms; share of lines containing none of the terms, for example vague words), "text_terms_present" (params: terms; share of the required terms that appear anywhere), "text_ids_valid" (params: find, a loose regular expression for things that look like IDs, and valid, the strict regular expression an ID must fit). Use it when the criterion itself names the items to look for (for example "of grant date, approver, last review date, expiry, reason") or the words to avoid. Use the terms or pattern the source states. If the source does not list them, propose them and say so in "uncertain" ("terms for X were proposed by the model; confirm"). Also say in "uncertain" when the count uses lines of text while the source counts something else (fields, rows). If the count needs fields, rows or a table the text does not show, or a person's judgement, give no "check". Never invent a check to avoid giving work to a person.

Reply with one JSON object and nothing else, in this shape (the // notes are for you, do not write them):
${FORMAT}`;

export function buildImportUser(sourceName: string, sourceText: string, outline: DocumentOutline | null): string {
  return [
    `<source_file name=${JSON.stringify(sourceName)}>\n${sourceText}\n</source_file>`,
    outline ? `<document_outline>\n${outline.text}\n</document_outline>` : '<document_outline>\nnone given\n</document_outline>',
  ].join('\n\n');
}
