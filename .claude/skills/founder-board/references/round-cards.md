# Round cards

Every lens returns exactly one card per round, in this format. No prose outside the card.
Keep each field short; the whole card fits on one screen.

## Round 1 card — independent position

```markdown
### <LENS> lens — Round 1

**Read of the brief:** <one sentence: what this lens thinks the real question is>

| Option | Score (0–10) | Why, through this lens (≤ 25 words) |
|--------|--------------|--------------------------------------|
| A      | 6            | …                                    |
| B      | 4            | …                                    |
| Baseline | 3          | …                                    |

**Top option:** <A | B | …>
**Vote (Evaluate mode only):** FUND | FUND IF <condition> | PASS
**What kills it:** <the single most likely way the top option fails>
**Ruin risk:** none | possible | likely — <what ruin means here: unrecoverable cash, legal, reputation, team>
**One-way door:** yes | no — <why it is or isn't reversible within ~3 months>
**Assumptions it rests on:** <1–3, each marked ASSUMPTION>
**Confidence:** low | medium | high
**Question this lens would ask the founder:** <one>
```

Rules: score every option, including the baseline. Ties are allowed. No reference to other
lenses — the lens has not seen them.

## Round 2 card — debate

```markdown
### <LENS> lens — Round 2

**Concedes to <OTHER LENS>:** <the strongest point from that card, and what it changes>
**Concedes to <OTHER LENS>:** <…>
**Rejects:** <one claim from another card, and why through this lens's framework>
**On each crux:**
- Crux 1: <position, ≤ 25 words>
- Crux 2: <…>
- Unanimity alarm (if raised): <steelman of the named alternative, then the lens's honest score for it>

| Option | R1 | R2 | Reason for change (required if |Δ| ≥ 1) |
|--------|----|----|-------------------------------------------|
| A      | 6  | 5  | …                                         |
| B      | 4  | 6  | …                                         |

**Top option:** <…>
**Vote (Evaluate mode only):** FUND | FUND IF <condition> | PASS
**Ruin risk:** none | possible | likely — <updated>
**One-way door:** yes | no
**Confidence:** low | medium | high
**The test that would change my score most:** <experiment + what result would move it>
```

Rules: a lens must concede at least one point (if nothing in the other cards is worth
conceding, say why). It may revise scores in either direction. It may not adopt another lens's
criteria as its own.
