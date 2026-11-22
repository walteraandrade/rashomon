---
name: rashomon
description: Which words stick to a Brazilian political figure
colors:
  bg: "#0c100f"
  panel: "#121816"
  soft: "#1a2220"
  line: "#27322d"
  ink: "#e9efea"
  muted: "#9fada5"
  faint: "#6f7d75"
  accent: "#f2b53c"
  accent-ink: "#141209"
  hostile: "#ff8593"
  favor: "#7ee08f"
  heat: "#8fd8c9"
  neighbor: "#b9cdc0"
  danger: "#ff8a8a"
  mid: "#a3a8b3"
  cmp-a: "#8fb4ff"
  cmp-b: "#ffa47c"
typography:
  display:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "clamp(38px, 5.4vw, 66px)"
    fontWeight: 500
    lineHeight: 1.04
    letterSpacing: "-0.015em"
  heading:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "clamp(28px, 3vw, 38px)"
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  word:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "14px to 46px, by the figure's own scale"
    fontWeight: 500
    lineHeight: 1.24
  body:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  caption:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  eyebrow:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.04em"
rounded:
  sm: "2px"
  md: "2px"
  lg: "2px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "24px"
  6: "32px"
  7: "48px"
  8: "clamp(56px, 7vw, 96px)"
components:
  chip:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.accent}"
    border: "1px solid {colors.line}"
    rounded: "{rounded.sm}"
    padding: "0 1.25em 0 0.5em"
    height: "1.6em"
  quiet-button:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.muted}"
    rounded: "{rounded.sm}"
    padding: "7px 12px"
  control-active:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.ink}"
    underline: "2px inset {colors.accent}"
    rounded: "{rounded.sm}"
    padding: "6px 16px"
  figure:
    backgroundColor: "{colors.panel}"
    border: "1px solid {colors.line}"
    rounded: "{rounded.sm}"
---

## Overview

A dark bench of instruments ("bancada"), not a dashboard and not a magazine. Newsreader, a serif made for reading news on a screen, names things and writes every word a figure draws: the words are what the press printed, so they are set like print. IBM Plex Sans explains; IBM Plex Mono measures: every number, axis label and key name. Legibility and beauty come before density: a figure shows fewer, larger, correctly spelled words (accents restored from the corpus, `GET /api/labels`) rather than more, smaller ones. The page is ten figures under one h1, each on a `--panel` sheet with a 1px `--line` outline over a dot-grid ground. Rank is carried by weight, case and family at least as much as by size. Colour is a second hierarchy, reserved for meaning: the live control (amber), evaluation, and which side of a comparison a word belongs to. Help is a key on each figure plus a dialog that intercepts "como ler" so the reader never has to leave the graph.

## Colors

Strategy: full palette for data, restrained for chrome. Neutrals are oscilloscope black-green (hue ~150), never warm charcoal and never pure grey. Amber is the one live hue and also the label marker (`//` before every eyebrow).

| Rank | Token | Job |
| --- | --- | --- |
| Read | `--ink` | headings, body, the thing itself |
| Live | `--accent` | chips, links, selection, the sentence you can edit |
| Against / for | `--hostile` / `--favor` | kikori and the atlas mask |
| Who | `--cmp-a` / `--cmp-b` | the ruler's two people |
| Support | `--muted` | captions, keys' meanings, chrome labels |

Surfaces stack `--bg` (with the 16px dot grid) < `--panel` < `--soft`. Every figure sits on `--panel` with the site's one border, `1px solid --line`, drawn on every figure and dialog alike. A data hue on a surface fights the marks (green card vs pink/lilac evaluation; blue card vs the ruler's two people) and, on a bipolar chart, picks a side. Which graph you are in is the eyebrow and the h2. `--green` is the neighbour highlight on the unmasked map and is not the evaluation green. `--danger` is errors only. `SCALE_MID` (`#a3a8b3`, `--scale-mid`) is "no signal" on every ramp, light enough that a neutral word still reads at a glance. `--heat` is intensity on a grid (agenda, quem aparece junto, persistência, the week's volume bar), never evaluation and never "who". Do not colour a heading to make it findable.

## Typography

One ramp, `--t-mega` … `--t-micro`. A rule writes `font-size: var(--t-*)`, never a px literal. `--t-micro` (11px) is the floor and belongs to SVG labels only; a word drawn on a ruler or in the week is never under 14px (`RULER_SIZE_MIN`, `WEEK_SIZE_MIN`).

- h1 `--t-mega` display 500 ink: the page, once; the masthead sets it beside the lede so the atlas starts on the first screen
- h2 `--t-xl` display 500 ink: a figure, a chapter, the dialog title
- h3 `--t-lg` display 500 ink: a block inside one
- `.lede`, p, li, `.sentence-line` `--t-base` sans 400
- `.figure-sub` `--t-sm` sans 400 muted
- `.figure-key dt` `--t-2xs` mono 500 ink: names an encoding; `dd` `--t-sm` sans, ink mixed toward muted
- `.eyebrow` `--t-2xs` mono 500 muted, after a `//` in accent: names whatever sits under it
- `.stat dd` `--t-lg` mono 500 ink tabular: a measurement
- words on the map, the rulers, the week and the lists: `--word` (Newsreader) 500, sized by the score; a word that crosses a guide line carries a stroke in the panel colour under its fill

Space above a heading is its rank. `dt`/`dd` is the label-and-number pair; `.stat` inverts it. `layout.ts` measures text with the same families (`FONT_WORD`, `FONT_MONO`, `FONT_DISPLAY`), so a face change is a change in both files.

## Elevation

One border: `1px solid --line`, square corners (2px), on every figure, chip, segment, search field and dialog. Nothing else draws a line; grouping inside a figure is a surface wash or a gap. Three tinted shadows on the floating docs card; none on the figures. Focus is an inset accent wash, never a ring.

## Components

- **Sentence chips.** `<select>` in `.pick`: mono, filled `--soft`, 1px `--line`, text `--accent`, chevron in accent. The only control surface on the page.
- **Figure key.** A `dl.figure-key` of tamanho / cor / posição / clique, under the drawing, above a hairline: the data comes first and the key is where the eye lands after it. Always visible. The encoding, not the essay; a figure has no second, looser legend repeating it (the atlas's person mean lives inside its Cor row).
- **Rulers.** Words placed by side, sized by documents on both sides combined, with the scale drawn as one gradient bar under the words, never a line through them. A bridge is a small amber diamond to the left of the word, on the five strongest only.
- **Strip (figure 2).** The axis fits the data (±2, ±5 or ±10, the smallest that holds every outlet). Up to six outlets carry their name in a band above or below, joined by a hairline that runs behind the dots; the person's mean keeps its own place in the top band. Per-source means are coloured type with a dot, never a filled badge.
- **Grids.** Agenda, quem aparece junto and persistência share `--heat` on one ramp; a cell's number flips to dark text past the middle of the ramp. Column heads are ink, rotated, each foot on its own column.
- **Help dialog.** `#helpDialog`, modal, same card language as `#docsDialog`. Opened by any in-page `/como-ler` link; modifier-click and `data-leave` still go to the page.
- **Docs dialog.** Floating above 760px, modal below. The only path to `GET /docs`.
- **Loading.** Ghost of the figure's own geometry (`--soft` wash of `--ink`), pulse until the recorte lands. A refetch dims what is already on screen. No spinner, no "Carregando…", no invented words.
- **Quiet button / segment.** `--soft` chrome; every active control, a pressed segment or a toggle alike, is `--soft` with ink text and a 2px inset amber underline.

## Do's and Don'ts

- Do put the key on the figure. Don't send the reader to another URL to learn the graph.
- Do use colour for a datum. Don't use colour to rank a heading.
- Do keep one type ramp. Don't invent a `font-size` in px.
- Do draw limits with type, space and the one hairline. Don't add a second kind of line, a side stripe, a radius above 2px, or a card around every block inside a figure.
- Do leave `--hostile`/`--favor` for evaluation and `--cmp-a`/`--cmp-b` for the ruler. Don't reuse red/green for "who". Don't tint a figure with a data hue.
- Do hold a figure's silhouette while it waits. Don't dump "Carregando…" into an empty hole.
