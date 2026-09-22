# Prompts

The three prompts of issue #176, verbatim. `run.sh` reads each one from the fenced block under its heading, so this file is the prompt, not a copy of it. Nothing may depend on `marks.ts` existing: the same text runs on the commit before it.

## T1

```
On figure 4 (`#rising`), add a `data-count` attribute to every word on the ruler carrying `count_recent_raw`, and show it in the word's `<title>`. Tests green, bundle rebuilt.
```

## T2

```
On figure 3 (`#compare`), add a `Limpar` button in the figure's toolbar that releases the selected word and closes the docs card if this figure opened it. Tests green, bundle rebuilt.
```

## T3

```
When the atlas (figure 1) changes `person`, figure 5 (`#week`) follows the same person. Tests green, bundle rebuilt.
```
