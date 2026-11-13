# Scoring

The Chair computes the verdict mechanically from the Round 2 cards. The Chair never edits a
lens's score; it only applies the formula and the caps below, and shows its arithmetic.

## 1. Weights

Set before Round 1, one line of reasoning each:

| Weight | Meaning |
|--------|---------|
| 3 | This lens's framework is central to the question (e.g. Offers on a pricing question) |
| 2 | Relevant |
| 1 | Peripheral, but still a check |

No lens gets 0. Weights do not change after Round 1.

## 2. Option score

```
score(option) = Σ (weight_lens × R2_score_lens) / Σ weight_lens
```

Round to one decimal. The winning option is the highest score; on a tie, the one with the lower
spread wins; if still tied, say so and let the next test decide.

## 3. Bands

| Score | Band |
|-------|------|
| ≥ 7.5 | **GO** |
| 6.0 – 7.4 | **GO WITH CONDITIONS** — list the conditions (from `FUND IF` votes and "what kills it") |
| 4.5 – 5.9 | **RESHAPE** — the idea has something; this version doesn't. Say what to change |
| < 4.5 | **DON'T DO IT** |

In Evaluate mode the single option's band is the verdict; also report the three votes.

## 4. Risk caps (applied in this order; the strictest wins)

| Condition (from Round 2 cards for the winning option) | Cap |
|---------------------------------------------------------|-----|
| Any lens marks **Ruin risk: likely** | at most **RESHAPE** |
| Two or more lenses mark **Ruin risk: possible** | at most **GO WITH CONDITIONS** |
| **One-way door: yes** from any lens **and** any lens at confidence **low** | at most **GO WITH CONDITIONS**, with a condition that makes the door reversible or stages it |
| Any `PASS` vote (Evaluate mode) | at most **GO WITH CONDITIONS** |

A cap lowers the band, never the number: report both ("6.8 → capped at RESHAPE: ruin risk
likely, Offers lens").

## 5. Spread and confidence

- **Spread** = highest minus lowest R2 score for the winning option.
- **Board confidence**:
  - **high** — spread ≤ 2, no cap applied, no lens at low confidence;
  - **medium** — spread 2.1–4, or one cap applied, or one lens at low confidence;
  - **low** — spread > 4, or two or more of the above.
  - If the unanimity alarm was raised and Round 2 changed nothing (same top option for every
    lens, no score moved by ≥ 1), confidence is **at most medium**: the agreement was never
    really tested.

## 6. Unanimity alarm (recap)

Raised between rounds when all three Round 1 top options match **and** their scores for that
option are within 1 point. It forces a steelman of the strongest unargued alternative in
Round 2. It does not change the formula; it feeds confidence (above) and must be reported.

## 7. Verdict block

```markdown
## Verdict — <question>

| Option | Offers (w) | Monopoly (w) | Product (w) | Weighted | Band |
|--------|-----------|--------------|-------------|----------|------|
| A      | 6 (3)     | 5 (2)        | 7 (1)       | 5.8      | RESHAPE |

**Decision:** <BAND> — <option> (<score>)<, capped from … : reason>
**Spread:** <n> · **Confidence:** <high|medium|low> · **Unanimity alarm:** <raised/not raised>
**Conditions / what to change:** <bullets>
**What would kill it:** <one line>
**Next test (≤ 2 weeks):** <experiment> — **kill criterion:** <result that stops it, stated now>
```
