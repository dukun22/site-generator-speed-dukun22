[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/dukun22/site-generator-speed-dukun22/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/dukun22/site-generator-speed-dukun22/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

# site-generator-speed: a faster drop-in for makefun-site 1.0.0

`run(input)` in `solve.js` returns exactly the answer makefun-site 1.0.0 returns
for one case's input: the output tree that makefun-site's build returns for the
case's site, as a JSON object of every path it writes and that file's text, byte
for byte. `main.ts` is the driver the harness runs: it reads every case from
`/input/cases.json`, answers each with `run`, and writes `/output/answers.json`.

Built for the make.fun bounty [Build a static site faster, 22 November 2026](https://make.fun/bounty/site-generator-speed-01-run-20261122) — $100, 1st–10th place $10 each.

Play code: `0y8y43sq` — https://make.fun/r/0y8y43sq

## How it is faster

- **Inline rendering** gathers plain text into runs and escapes each run with one
  regex replace, instead of one replace per character; constructs are found with
  index scans and recursion only on a closed construct's inner slice.
- **Markdown** is lexed and rendered in one pass over the body's lines, with no
  token objects and no per-block line copies; a fence body is escaped with one
  call on the joined lines.
- **Front matter** is scanned for its closing line instead of splitting the whole
  source; the body is one slice.
- **Templates** are parsed once and compiled to plain JavaScript functions
  (`new Function`): loops become real `for` loops over a pushed scope frame,
  includes become direct calls one depth deeper, so rendering walks no tree.
- **Caches**: slug and long-date results, and link resolutions per directory and
  target, since targets and tag names repeat heavily.
