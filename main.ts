// main.ts — build the token-radar-01 entry (Node 22, standard library only).
//
// Reads the sealed DefiLlama snapshot, ranks the pre-token protocols with
// the peer-multiple model in lib/radar.ts, and writes everything the gate
// and the judge read:
//
//   /output/board.json     the ranked board (rows)
//   /output/data.js        the same board, as window.RADAR for the page
//   /output/dashboard/    the static page (copied from this repository)
//   /output/screenshots/  the three screenshots (copied from this repository)
//   /output/dossier.json  what the judge reads, via vendor/makefun-board.ts
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for
// /output and --input names the snapshot:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The program is deterministic: the same snapshot always writes the same
// bytes, so the grader's two runs agree.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  boardIssue,
  buildBoard,
  dataScript,
  packForPage,
  parseSnapshot,
} from './lib/radar.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The caps the dossier builder enforces, matching the gate's own. */
const DOSSIER_TEXT_BYTES = 65_536;
const SHOT_LIMIT = { max: 4, max_bytes: 524_288 };
const DASH_LIMIT = { max_files: 400, max_bytes: 4_194_304 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read `--name value` or `--name=value` from the arguments. */
function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

const inputArg = flag('input', '/input');
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  process.stderr.write(
    `token radar: no snapshot at ${snapshotPath} — pass --input <snapshot.json|directory> or mount the sealed /input\n`,
  );
  process.exit(2);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snap = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const built = buildBoard(snap);
const pack = packForPage(snap, built);
const boardRows = built.rows.map((r) => ({
  slug: r.slug,
  name: r.name,
  rank: r.rank,
  implied_value_usd: r.implied_value_usd,
  farm_steps: r.farm_steps,
}));
const problem = boardIssue(built.rows, snap);
if (problem !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${problem}\n`);
  process.exit(1);
}

/** Copy a directory's plain files into `to`, skipping dot-names. */
function copyPlain(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    names.push(name);
  }
  return names;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: boardRows })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(pack));

const dashFiles = copyPlain(join(here, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyPlain(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(
    `token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'} — hand in 3: the board, a detail view and a filtered view\n`,
  );
  process.exit(1);
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) {
    process.stderr.write(
      `token radar: screenshots/${name} — a name is letters, digits and . _ -, 1 to 128 characters\n`,
    );
    process.exit(1);
  }
}

// The dossier goes last: the scorer rebuilds it from this directory and
// compares the bytes, so it must be written from the finished /output.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: DOSSIER_TEXT_BYTES,
    screenshots: SHOT_LIMIT,
    dashboard: DASH_LIMIT,
  }),
);

const top = built.rows[0]!;
process.stdout.write(
  `token radar: ${snap.protocols.length} protocols scanned, ${snap.watchlist.length} on the watchlist, ${built.rows.length} rows ranked\n` +
    `token radar: rank 1 is ${top.slug} at $${top.implied_value_usd.toLocaleString('en-US')} implied; board total $${pack.total_implied_usd.toLocaleString('en-US')}\n` +
    `token radar: ${built.multiples.length} category multiples calibrated, ${built.peerExamples.length} categories with representative peers\n` +
    `token radar: wrote board.json, data.js, dashboard (${dashFiles.length} files), screenshots (${shots.length} images) and dossier.json into ${outDir}\n`,
);
