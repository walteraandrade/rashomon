---
name: rashomon
description: Which words stick to a Brazilian political figure
colors:
  bg: "#131210"
  panel: "#1c1b18"
  soft: "#26241f"
  line: "#3a372f"
  ink: "#f4f1ea"
  muted: "#a39e93"
  accent: "#e9e4d8"
  accent-ink: "#14120f"
  hostile: "#ff6b7d"
  favor: "#7ee787"
  neighbor: "#cfd6c8"
  danger: "#ef9a9a"
  mid: "#8b909c"
  cmp-a: "#7fa8ff"
  cmp-b: "#ff9d6b"
typography:
  display:
    fontFamily: "League Spartan, Instrument Sans, system-ui, sans-serif"
    fontSize: "clamp(38px, 5.6vw, 68px)"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  heading:
    fontFamily: "League Spartan, Instrument Sans, system-ui, sans-serif"
    fontSize: "clamp(26px, 3vw, 38px)"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Instrument Sans, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  caption:
    fontFamily: "Instrument Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  eyebrow:
    fontFamily: "League Spartan, Instrument Sans, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.14em"
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
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
    rounded: "{rounded.sm}"
    padding: "0 1.25em 0 0.5em"
    height: "1.55em"
  quiet-button:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.muted}"
    rounded: "{rounded.sm}"
    padding: "7px 12px"
  segment-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "999px"
    padding: "7px 16px"
---

## Overview

Dark editorial tool, not a dashboard. League Spartan names; Instrument Sans explains. The page is three figures under one h1. Type draws every limit (the site has no borders). Colour is a second hierarchy, reserved for meaning: the live control, evaluation, and which side of a comparison a word belongs to. Help is a key on each figure plus a dialog that intercepts "como ler" so the reader never has to leave the graph.

## Colors

Strategy: full palette for data, restrained for chrome. Neutrals are charcoal tinted toward the cream accent (hue ~90), never a cream page and never pure grey.

| Rank | Token | Job |
| --- | --- | --- |
| Read | `--ink` | headings, body, the thing itself |
| Live | `--accent` | chips, links, selection, the sentence you can edit |
| Against / for | `--hostile` / `--favor` | kikori and the atlas mask |
| Who | `--cmp-a` / `--cmp-b` | the ruler's two people |
| Support | `--muted` | captions, keys' meanings, chrome labels |

Surfaces stack `--bg` < `--panel` < `--soft`. Every figure sits on `--panel`. A data hue on a surface fights the marks (green card vs pink/lilac evaluation; blue card vs the ruler's two people) and, on a bipolar chart, picks a side. Which graph you are in is the eyebrow and the h2. `--green` is the neighbour highlight on the unmasked map and is not the evaluation green. `--danger` is errors only. `SCALE_MID` (`#8b909c`) is "no signal" on every ramp. Do not colour a heading to make it findable.

## Typography

One ramp, `--t-mega` … `--t-micro`. A rule writes `font-size: var(--t-*)`, never a px literal. `--t-micro` (11px) is the floor and belongs to SVG labels only.

- h1 `--t-mega` display 700 ink: the page, once
- h2 `--t-xl` display 700 ink: a figure, a chapter, the dialog title
- h3 `--t-lg` display 700 ink: a block inside one
- `.lede` `--t-lg` sans 400 muted
- `.sentence-line` `--t-lg` sans 500 ink: the recorte you can change
- p, li `--t-base` sans 400 ink
- `.figure-sub` `--t-sm` sans 400 muted
- `.figure-key dt` `--t-2xs` display 500 ink uppercase: names an encoding
- `.figure-key dd` `--t-sm` sans 400 muted: what it means
- `.eyebrow` `--t-2xs` display 500 muted uppercase: names whatever sits under it

Space above a heading is its rank. `dt`/`dd` is the label-and-number pair; `.stat` inverts it.

## Elevation

No borders. Grouping is a surface wash or a gap. Cards exist when a dialog has to sit on the page (documents, the guide). Three tinted shadows on the floating docs card; none on the figures. Focus is an inset accent wash, never a ring.

## Components

- **Sentence chips.** `<select>` in `.pick`: filled `--soft`, text `--accent`, chevron in accent. The only control surface on the page.
- **Figure key.** A `dl.figure-key` of tamanho / cor / clique (or posição). Always visible. The encoding, not the essay.
- **Help dialog.** `#helpDialog`, modal, same card language as `#docsDialog`. Opened by any in-page `como-ler.html` link; modifier-click and `data-leave` still go to the page.
- **Docs dialog.** Floating above 760px, modal below. The only path to `GET /docs`.
- **Quiet button / segment.** `--soft` chrome; pressed segment floods `--accent`.

## Do's and Don'ts

- Do put the key on the figure. Don't send the reader to another URL to learn the graph.
- Do use colour for a datum. Don't use colour to rank a heading.
- Do keep one type ramp. Don't invent a `font-size` in px.
- Do draw limits with type and space. Don't add a border, a side stripe, or a card around every block.
- Do leave `--hostile`/`--favor` for evaluation and `--cmp-a`/`--cmp-b` for the ruler. Don't reuse red/green for "who". Don't tint a figure with a data hue.
