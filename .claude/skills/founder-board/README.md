# founder-board

**[Español](#español) · [English](#english)**

A Claude Code skill: a board of three lenses — **Offers**, **Monopoly**, **Product** — that
evaluates a product or decides a growth question in two rounds of debate.

```
.claude/skills/founder-board/
├── SKILL.md                    the procedure the Chair (Claude) follows
├── references/
│   ├── lenses.md               the three rubrics
│   ├── round-cards.md          Round 1 and Round 2 card formats
│   └── scoring.md              weights, bands, risk caps, confidence
└── examples/
    └── example-session.md      a full fictional run
```

---

## Español

### Qué hace

Pones una pregunta delante del board y Claude actúa como **Presidente**: arma un brief, fija
pesos por lente y corre el debate.

1. **Ronda 1 — posiciones a ciegas.** Cada lente (un subagente por lente) puntúa cada opción de
   0 a 10, dice qué la mataría, marca riesgo de ruina y si es una puerta de un solo sentido.
2. **Cruces.** El Presidente escribe 2–3 *cruxes* donde las lentes chocan. Si las tres eligieron
   lo mismo con puntajes a ≤ 1 punto, salta la **alerta de unanimidad**: se nombra la mejor
   alternativa que nadie defendió y la Ronda 2 está obligada a evaluarla en serio.
3. **Ronda 2 — debate.** Cada lente lee las otras dos tarjetas, concede al menos un punto,
   rechaza otro y revisa sus puntajes justificando cada cambio.
4. **Veredicto.** Promedio ponderado por pesos → banda (**GO** ≥ 7.5, **GO CON CONDICIONES**
   6.0–7.4, **REFORMULAR** 4.5–5.9, **NO LO HAGAS** < 4.5), con **topes por riesgo** (riesgo de
   ruina probable → máximo REFORMULAR, etc.), dispersión, confianza y **la próxima prueba**
   de ≤ 2 semanas con criterio de corte fijado de antemano.

Dos modos: **Evaluar** (un producto; cada lente vota FINANCIAR / FINANCIAR SI / PASAR) y
**Decidir** (2–4 opciones más una línea base de "seguir igual").

### Las lentes son marcos, no personas

Cada lente aplica un marco de negocio publicado como lista de preguntas, resumido con palabras
propias. Ninguna lente habla como su autor, imita su voz ni inventa citas.

| Lente | Pregunta | Marco publicado en que se basa |
|-------|----------|--------------------------------|
| Ofertas | ¿El comprador diría que sí hoy, a este precio? | La ecuación de valor de *$100M Offers* (Alex Hormozi) |
| Monopolio | ¿Puede ser la única respuesta en algún mercado, y seguir siéndolo? | *Zero to One* (Peter Thiel con Blake Masters) |
| Producto | ¿Es lo bastante enfocado, simple y completo para que una persona concreta lo ame? | Los principios de producto descritos en la biografía *Steve Jobs* (Walter Isaacson) |

Este proyecto no está afiliado a esos autores.

### Instalar

Copia la carpeta a tus skills personales o a las de un proyecto:

```bash
# personal (todas tus sesiones)
cp -r .claude/skills/founder-board ~/.claude/skills/
# o solo en un proyecto
cp -r .claude/skills/founder-board <tu-proyecto>/.claude/skills/
```

Luego en Claude Code: *"corre el board: ¿subimos precio o abrimos un nuevo segmento?"* o
`/founder-board evalúa mi producto`.

El veredicto se guarda en `founder-board/AAAA-MM-DD-<tema>.md` dentro de tu proyecto. Nada sale
de tu máquina por la skill.

### Créditos

- **[The Founder Skill](https://github.com/Jakeschincariol/founder-skill)** de Jake Schincariol
  (MIT) — la idea del board de tres lentes (Ofertas, Monopolio, Producto) con puntaje, "qué lo
  mata" y voto financiar / financiar si / pasar.
- **[Roast Room](https://github.com/nateherkai/roast-room)** de AI Automation Society (MIT) — la
  mecánica del debate: rondas con tarjetas, *cruxes* escritos por el Presidente, alerta de
  unanimidad, puntaje ponderado por relevancia, bandas de veredicto y topes por riesgo de ruina
  y puertas de un solo sentido.

founder-board combina ambas ideas y las reescribe; no copia sus textos.

### Licencia

MIT — ver [LICENSE](LICENSE).

---

## English

### What it does

You put a question in front of the board and Claude acts as **Chair**: it writes a brief, sets
per-lens weights and runs the debate.

1. **Round 1 — blind positions.** Each lens (one subagent per lens) scores every option 0–10,
   names what would kill it, flags ruin risk and whether it is a one-way door.
2. **Cross-examination.** The Chair writes 2–3 cruxes where the lenses collide. If all three
   picked the same option with scores within 1 point, the **unanimity alarm** fires: the
   strongest alternative nobody argued for is named and Round 2 must take it seriously.
3. **Round 2 — debate.** Each lens reads the other two cards, concedes at least one point,
   rejects another and revises its scores, justifying every change.
4. **Verdict.** Weighted average → band (**GO** ≥ 7.5, **GO WITH CONDITIONS** 6.0–7.4,
   **RESHAPE** 4.5–5.9, **DON'T DO IT** < 4.5), with **risk caps** (likely ruin risk → at most
   RESHAPE, etc.), spread, confidence and **the next test**: a ≤ 2-week experiment with a kill
   criterion set in advance.

Two modes: **Evaluate** (one product; each lens votes FUND / FUND IF / PASS) and **Decide**
(2–4 options plus a "keep current course" baseline).

### Lenses are frameworks, not people

Each lens applies a published business framework as a checklist, summarised in our own words.
No lens speaks as its author, imitates their voice or invents quotes.

| Lens | Asks | Published framework it draws on |
|------|------|---------------------------------|
| Offers | Would the buyer say yes today, at this price? | The value equation from *$100M Offers* (Alex Hormozi) |
| Monopoly | Can this become the only answer for some market, and stay that way? | *Zero to One* (Peter Thiel with Blake Masters) |
| Product | Is it focused, simple and complete enough for one specific person to love it? | The product principles described in the biography *Steve Jobs* (Walter Isaacson) |

This project is not affiliated with those authors.

### Install

Copy the folder into your personal skills or a project's:

```bash
# personal (all your sessions)
cp -r .claude/skills/founder-board ~/.claude/skills/
# or just one project
cp -r .claude/skills/founder-board <your-project>/.claude/skills/
```

Then in Claude Code: *"run the board: should we raise the price or open a new segment?"* or
`/founder-board evaluate my product`.

The verdict is saved to `founder-board/YYYY-MM-DD-<slug>.md` in your project. The skill sends
nothing off your machine.

### Credits

- **[The Founder Skill](https://github.com/Jakeschincariol/founder-skill)** by Jake Schincariol
  (MIT) — the three-lens board (Offers, Monopoly, Product) with a score, "what kills it" and a
  fund / fund if / pass vote.
- **[Roast Room](https://github.com/nateherkai/roast-room)** by AI Automation Society (MIT) — the
  debate mechanics: rounds of cards, Chair-written cruxes, the unanimity alarm,
  relevance-weighted scoring, verdict bands and caps for ruin risk and one-way doors.

founder-board combines and rewrites both ideas; it does not copy their text.

### License

MIT — see [LICENSE](LICENSE).
