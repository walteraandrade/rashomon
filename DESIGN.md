---
name: rashomon
description: Which words stick to a Brazilian political figure
colors:
  bg: "#0b0e0d"
  panel: "#111615"
  soft: "#1a2220"
  line: "#243029"
  ink: "#d6ded8"
  muted: "#7b8a82"
  accent: "#f0b429"
  accent-ink: "#111411"
  hostile: "#ff7a8a"
  favor: "#74dc86"
  neighbor: "#b9cdc0"
  danger: "#ff8a8a"
  mid: "#8b909c"
  cmp-a: "#7fa8ff"
  cmp-b: "#ff9d6b"
typography:
  display:
    fontFamily: "IBM Plex Sans Condensed, IBM Plex Sans, system-ui, sans-serif"
    fontSize: "clamp(34px, 5vw, 58px)"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.02em"
    textTransform: "uppercase"
  heading:
    fontFamily: "IBM Plex Sans Condensed, IBM Plex Sans, system-ui, sans-serif"
    fontSize: "clamp(24px, 2.8vw, 34px)"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.01em"
    textTransform: "uppercase"
  body:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "14px"
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
  segment-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.sm}"
    padding: "6px 16px"
  figure:
    backgroundColor: "{colors.panel}"
    border: "1px solid {colors.line}"
    rounded: "{rounded.sm}"
---

## Overview

A dark bench of instruments ("bancada"), not a dashboard and not a magazine. IBM Plex Sans Condensed names, in capitals; IBM Plex Sans explains; IBM Plex Mono measures: every number, label, chip, the sentence a reader edits, and every word drawn on a figure. The page is three figures under one h1, each on a `--panel` sheet with a 1px `--line` outline over a dot-grid ground. Rank is carried by weight, case and family at least as much as by size. Colour is a second hierarchy, reserved for meaning: the live control (amber), evaluation, and which side of a comparison a word belongs to. Help is a key on each figure plus a dialog that intercepts "como ler" so the reader never has to leave the graph.

## Colors

Strategy: full palette for data, restrained for chrome. Neutrals are oscilloscope black-green (hue ~150), never warm charcoal and never pure grey. Amber is the one live hue and also the label marker (`//` before every eyebrow).

| Rank | Token | Job |
| --- | --- | --- |
| Read | `--ink` | headings, body, the thing itself |
| Live | `--accent` | chips, links, selection, the sentence you can edit |
| Against / for | `--hostile` / `--favor` | kikori and the atlas mask |
| Who | `--cmp-a` / `--cmp-b` | the ruler's two people |
| Support | `--muted` | captions, keys' meanings, chrome labels |

Surfaces stack `--bg` (with the 16px dot grid) < `--panel` < `--soft`. Every figure sits on `--panel` with the site's one border, `1px solid --line`, drawn on every figure and dialog alike. A data hue on a surface fights the marks (green card vs pink/lilac evaluation; blue card vs the ruler's two people) and, on a bipolar chart, picks a side. Which graph you are in is the eyebrow and the h2. `--green` is the neighbour highlight on the unmasked map and is not the evaluation green. `--danger` is errors only. `SCALE_MID` (`#8b909c`, `--scale-mid`) is "no signal" on every ramp. Do not colour a heading to make it findable.

## Typography

One ramp, `--t-mega` … `--t-micro`. A rule writes `font-size: var(--t-*)`, never a px literal. `--t-micro` (11px) is the floor and belongs to SVG labels only.

- h1 `--t-mega` display 700 caps ink: the page, once
- h2 `--t-xl` display 700 caps ink: a figure, a chapter, the dialog title
- h3 `--t-lg` display 600 caps ink: a block inside one
- `.lede` `--t-base` mono 400 muted
- `.sentence-line` `--t-base` mono 400 ink: the recorte you can change
- p, li `--t-base` sans 400 ink
- `.figure-sub` `--t-sm` mono 400 muted
- `.figure-key dt` `--t-2xs` mono 500 accent: names an encoding
- `.figure-key dd` `--t-sm` mono 400 muted: what it means
- `.eyebrow` `--t-2xs` mono 500 muted, after a `//` in accent: names whatever sits under it
- `.stat dd` `--t-lg` mono 500 ink tabular: a measurement; its `dt` is an accent eyebrow
- words on the map, the ruler and the list: mono 500, sized by the score

Space above a heading is its rank. `dt`/`dd` is the label-and-number pair; `.stat` inverts it. `layout.ts` measures text with the same families (`FONT_MONO`, `FONT_DISPLAY`), so a face change is a change in both files.

## Elevation

One border: `1px solid --line`, square corners (2px), on every figure, chip, segment, search field and dialog. Nothing else draws a line; grouping inside a figure is a surface wash or a gap. Three tinted shadows on the floating docs card; none on the figures. Focus is an inset accent wash, never a ring.

## Components

- **Sentence chips.** `<select>` in `.pick`: mono, filled `--soft`, 1px `--line`, text `--accent`, chevron in accent. The only control surface on the page.
- **Figure key.** A `dl.figure-key` of tamanho / cor / posição / clique. Always visible. The encoding, not the essay.
- **Help dialog.** `#helpDialog`, modal, same card language as `#docsDialog`. Opened by any in-page `como-ler.html` link; modifier-click and `data-leave` still go to the page.
- **Docs dialog.** Floating above 760px, modal below. The only path to `GET /docs`.
- **Loading.** Ghost of the figure's own geometry (`--soft` wash of `--ink`), pulse until the recorte lands. A refetch dims what is already on screen. No spinner, no "Carregando…", no invented words.
- **Quiet button / segment.** `--soft` chrome; pressed segment floods `--accent`.

## Do's and Don'ts

- Do put the key on the figure. Don't send the reader to another URL to learn the graph.
- Do use colour for a datum. Don't use colour to rank a heading.
- Do keep one type ramp. Don't invent a `font-size` in px.
- Do draw limits with type, space and the one hairline. Don't add a second kind of line, a side stripe, a radius above 2px, or a card around every block inside a figure.
- Do leave `--hostile`/`--favor` for evaluation and `--cmp-a`/`--cmp-b` for the ruler. Don't reuse red/green for "who". Don't tint a figure with a data hue.
- Do hold a figure's silhouette while it waits. Don't dump "Carregando…" into an empty hole.
