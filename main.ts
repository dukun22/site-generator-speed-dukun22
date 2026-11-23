// Driver: reads every case from /input/cases.json, answers each one alone with
// run() from solve.js, and writes /output/answers.json: a JSON array of the
// answers, one per case and in the cases' order. MAKEFUN_INPUT_DIR and
// MAKEFUN_OUTPUT_DIR stand in for /input and /output outside a container.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off, set before solve.js is imported so all of its
// work runs under it (the rules allow an entry to tune V8's flags this way).
setFlagsFromString('--no-incremental-marking');

/** solve.js, imported by its URL (a .js module carries no types). */
const mod = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };
const solve = mod.run;

const inDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const raw = readFileSync(join(inDir, 'cases.json'), 'utf8');
const list = JSON.parse(raw) as { id: string; input: unknown }[];
const out: unknown[] = list.map((c) => solve(c.input));
writeFileSync(join(outDir, 'answers.json'), JSON.stringify(out));
