---
name: founder-board
description: Run a three-lens founder board (Offers, Monopoly, Product) that evaluates a product or decides a concrete growth question in two rounds of debate, with cross-examination between lenses, a unanimity alarm, weighted scoring and risk caps. Use when the user asks to "run the board", "put this in front of the board", evaluate a product/business idea, or choose between growth options (pricing, channel, niche, feature, launch).
---

# Founder Board

A board of three **lenses**. Each lens is a published business framework applied as a
checklist — never a person, never an impersonation, never a voice. You (the main agent) are
the **Chair**: you frame the question, run the rounds, enforce the rules and write the verdict.
The lenses argue; the Chair does not vote.

| Lens | Asks | Framework (summarised in our own words) |
|------|------|------------------------------------------|
| **Offers** | Would the target buyer say yes at this price, today? | The value-equation approach to offers: dream outcome × perceived likelihood, divided by time delay × effort; stacking, guarantees, pricing to value. |
| **Monopoly** | Can this become the only answer for some market, and stay that way? | The monopoly-vs-competition approach to startups: start with a small market and dominate it; proprietary technology (~10× better), network effects, economies of scale, brand; durability; distribution. |
| **Product** | Is the experience focused, simple and complete enough to be loved by one specific person? | The focus-and-simplicity approach to product: say no to almost everything, own the end-to-end experience, simplicity as the result of depth, taste in the details. |

Full rubrics: [`references/lenses.md`](references/lenses.md).

## Hard rules

1. **Lenses are frameworks, not people.** No first person as an author, no "as X would say",
   no catchphrases, no invented quotes. A lens speaks as "the Offers lens".
2. **No fabricated facts.** If a number is unknown, the lens says so and names the cheapest way
   to find it out. Assumptions are labelled `ASSUMPTION`.
3. **Private by default.** The verdict file stays in the user's project; nothing is sent
   anywhere. Do not ask for more data than the question needs.
4. **The Chair does not vote** and never edits a lens's scores. It may only apply the caps in
   [`references/scoring.md`](references/scoring.md).

## Modes

- **Evaluate** — "evaluate my product / idea". The single option is *the product as described*;
  each lens scores it 0–10 and votes `FUND` / `FUND IF …` / `PASS`.
- **Decide** — "should we do A, B or C?". 2–4 options (the Chair adds "do nothing / keep
  current course" as a baseline if the user didn't). Each lens scores every option 0–10.

If the user's request fits neither cleanly, pick Decide and state the options you inferred.

## Procedure

### 0. Brief (Chair)

Collect, in one short message if anything essential is missing (otherwise proceed):
product, target buyer, price/business model, stage and traction (as ranges is fine), the
question or options, constraints (time, money, team), and what would count as a one-way door.

Write the **brief**: ≤ 200 words, facts vs. assumptions marked. Then set **lens weights** for
this question (1–3 each, one line of reasoning per weight — e.g. a pricing question weights
Offers 3). Weights are fixed before Round 1 and never changed after.

### 1. Round 1 — independent positions

Run the three lenses **in parallel and blind to each other**: one subagent per lens if the Agent
tool is available, otherwise three clearly separated passes where you do not let one lens read
another's card. Each subagent gets: the brief, its own section of `references/lenses.md`, and
the Round 1 card format from [`references/round-cards.md`](references/round-cards.md). Nothing
else.

### 2. Chair between rounds — cross-examination and unanimity alarm

1. **Unanimity alarm.** If all three lenses picked the same top option **and** their scores for
   it are within 1 point, raise `UNANIMITY ALARM`: name the strongest alternative nobody argued
   for (it may be an option the lenses ranked lower or a variant none listed) and make it a
   mandatory crux. Agreement among frameworks is a signal to check, not a result.
2. **Cruxes.** Write 2–3 cruxes: the specific claims where the lenses disagree, or where a
   lens's score rests on an unverified assumption. Each crux is one sentence and names which
   lenses it involves.
3. **Cross assignments.** Every lens must answer the other two cards: what it concedes, what it
   rejects and why, through its own framework.

### 3. Round 2 — debate

Run the lenses again (parallel). Each gets: the brief, all three Round 1 cards, the cruxes, the
alarm (if any), and the Round 2 card format. Each returns revised scores with a reason for every
change of ≥ 1 point. A lens may change its mind; it may not abandon its framework.

### 4. Verdict (Chair)

Compute with [`references/scoring.md`](references/scoring.md): weighted score per option,
band, spread, caps, confidence. Then write the verdict file:

`founder-board/YYYY-MM-DD-<slug>.md` in the user's project (create the folder), containing the
brief, weights, both rounds' cards, cruxes, the score table and the verdict block. Show the user
the verdict block and the path — not the whole file.

The verdict block always ends with **the next test**: the cheapest experiment, ≤ 2 weeks, that
would most change the verdict, with a kill criterion stated in advance.

## Calibration

- A 7+ needs evidence, not enthusiasm. Without traction data, cap your own scores at 7.
- "It depends" is not an answer: state what it depends on and score the likely case.
- Be specific to *this* product. If a sentence would fit any startup, cut it.
- Answer in the user's language.

See a full run in [`examples/example-session.md`](examples/example-session.md).
