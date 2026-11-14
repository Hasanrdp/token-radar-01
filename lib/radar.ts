// radar.ts — the launch-value model for the token radar.
//
// The snapshot carries no ranking, so this module derives one from the
// snapshot's own figures only. The idea is comparables pricing, the way a
// desk would price an unlisted company: look at the listed peers in the
// same line of business, take the median of what the market pays for each
// dollar of their TVL, and apply that multiple to the pre-token protocol's
// own TVL. Then adjust for what the snapshot also records: how fast the
// TVL moved in the last seven days, and how long the protocol has run
// without a token. Nothing here names a protocol in advance; every number
// below is computed from the snapshot at run time.
//
//   implied = TVL x category multiple x growth factor x maturity factor
//             x chain-breadth factor
//
// The board ranks pre-token protocols only (both gecko_id and symbol are
// null in the snapshot). Tokenised protocols are never ranked; they are the
// peer set the multiples are calibrated on, and the dashboard shows them
// in a separate "already trading" panel so the two groups stay apart.
//
// A record with no token is not enough on its own: a wrapped, staked or
// bridged product of a token that already trades is not a protocol still
// waiting on a launch of its own. WBTC is Bitcoin on Ethereum, a bridge
// moves a token that already trades, and a "V2" of a tokenised protocol
// shares its token. So the board applies the same exclusion the house's
// watchlist uses — the bridged/staked categories, versioned names, wrapped
// or staked wording, and exchange-prefixed names — and ranks only what
// survives it. The snapshot carries no parent-protocol field, so the name
// and category rules are the ones applied here.

export interface Proto {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snap {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

export interface ValueParts {
  multiple: number;
  peerCount: number;
  growthFactor: number;
  growthPct: number;
  maturityFactor: number;
  ageDays: number | null;
  breadthFactor: number;
  chainCount: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface PageRow extends BoardRow {
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  on_watchlist: boolean;
  multiple: number;
  multiple_basis: string;
  peer_count: number;
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
  age_days: number | null;
  capital_usd: number;
}

export interface LivePeer {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

export interface CategoryMultiple {
  category: string;
  multiple: number;
  peers: number;
  median_peer_mcap: number;
}

export interface RadarPack {
  as_of: string;
  source: string;
  floor_usd: number;
  scanned: number;
  watchlist_size: number;
  board_size: number;
  total_implied_usd: number;
  model: {
    name: string;
    formula: string;
    growth_note: string;
    maturity_note: string;
    breadth_note: string;
  };
  categories: CategoryMultiple[];
  rows: PageRow[];
  live: LivePeer[];
  peer_examples: { category: string; peers: LivePeer[] }[];
}

export class RadarError extends Error {}

const DAY_MS = 86_400_000;
const MIN_PEERS = 4;
const BOARD_ROWS = 240;
const LIVE_PEERS = 24;

/** Clamp a number into [lo, hi]. */
function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** Median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Days between the snapshot date and the day DefiLlama started tracking. */
export function ageInDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const days = Math.round((end - start) / DAY_MS);
  return days < 0 ? 0 : days;
}

/** True when the snapshot records no token for the protocol. */
export function recordsNoToken(p: Proto): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/**
 * The watchlist's own exclusion, applied to every board candidate: a
 * wrapped, staked or bridged product of a token that already trades is not
 * a launch waiting to happen. Categories that only move or restake another
 * token, a name ending in a version marker, a whole word wrapped/staked/
 * staking in the name, or a name beginning with an exchange's name.
 */
const WRAPPED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_NAMES = [
  'Binance',
  'Coinbase',
  'Bybit',
  'Kraken',
  'Bitget',
  'OKX',
  'Bitfinex',
  'Gemini',
];

export function isWrappedOrStakedProduct(p: Proto): boolean {
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return true;
  if (VERSIONED_NAME.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  return EXCHANGE_NAMES.some((exchange) => p.name.startsWith(exchange));
}

/** True when the protocol is a genuine pre-token candidate for the board. */
export function isBoardCandidate(p: Proto): boolean {
  return recordsNoToken(p) && !isWrappedOrStakedProduct(p);
}

/**
 * The market multiple for a category: the median mcap/TVL across the
 * tokenised protocols in that category. A category with fewer than four
 * priced peers falls back to the global median, so no category is priced
 * off one or two names.
 */
export function categoryMultiples(protocols: Proto[]): {
  byCategory: Map<string, CategoryMultiple>;
  global: number;
} {
  const priced = protocols.filter(
    (p) => !recordsNoToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const global = median(priced.map((p) => p.mcap_usd! / p.tvl_usd));
  const groups = new Map<string, Proto[]>();
  for (const p of priced) {
    const key = p.category ?? 'Uncategorised';
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, peers] of groups) {
    const ratios = peers.map((p) => p.mcap_usd! / p.tvl_usd);
    const useGlobal = peers.length < MIN_PEERS;
    byCategory.set(category, {
      category,
      multiple: useGlobal ? global : median(ratios),
      peers: peers.length,
      median_peer_mcap: median(peers.map((p) => p.mcap_usd!)),
    });
  }
  return { byCategory, global };
}

/**
 * The four factors behind one protocol's implied value, each derived from
 * the snapshot alone:
 * - growth: the 7-day TVL move, clamped to [-60%, +120%] and worth at
 *   most +/-42% of value (0.35 per 100 points of move), so a hot week
 *   lifts a protocol but never doubles it on one print.
 * - maturity: how long it has run with no token. Under 90 days the
 *   protocol is young and unproven (0.85); the factor then rises
 *   linearly to 1.00 at two years. Unknown listing date scores 0.90.
 * - breadth: each extra chain past the first adds 2%, capped at +10%,
 *   because multi-chain TVL is harder to fake and easier to keep.
 */
export function valueParts(
  p: Proto,
  asOf: string,
  multiple: number,
  peerCount: number,
): ValueParts {
  const growthPct = p.change_7d === null ? 0 : p.change_7d;
  const growthFactor = 1 + 0.35 * (clamp(growthPct, -60, 120) / 100);
  const age = ageInDays(asOf, p.listed_at);
  const maturityFactor =
    age === null ? 0.9 : age < 90 ? 0.85 : 0.85 + 0.15 * Math.min(1, age / 730);
  const breadthFactor = 1 + 0.02 * Math.min(Math.max(p.chains.length - 1, 0), 5);
  return {
    multiple,
    peerCount,
    growthFactor,
    growthPct,
    maturityFactor,
    ageDays: age,
    breadthFactor,
    chainCount: p.chains.length,
  };
}

/** Implied launch value in whole dollars, capped at $100B. No floor is
 * applied beyond $1: a floor would break the breakdown the detail view
 * shows (TVL x multiple x growth x maturity x breadth must multiply out
 * to the value displayed), so small protocols keep their true value. */
export function impliedValue(p: Proto, parts: ValueParts): number {
  const raw =
    p.tvl_usd * parts.multiple * parts.growthFactor * parts.maturityFactor * parts.breadthFactor;
  return Math.max(1, Math.min(100_000_000_000, Math.round(raw)));
}

/** Working capital the farm plan sizes itself to, by TVL tier. */
export function capitalFor(tvl: number): number {
  if (tvl >= 500_000_000) return 2000;
  if (tvl >= 100_000_000) return 1000;
  return 500;
}

/** Typical gas for one transaction on a chain, as the plan quotes it. */
function gasFor(chain: string): string {
  const table: Record<string, string> = {
    Ethereum: '$2–$12',
    Solana: 'under $0.01',
    Base: '$0.02–$0.10',
    Arbitrum: '$0.05–$0.30',
    Optimism: '$0.05–$0.30',
    Polygon: '$0.01–$0.05',
    Avalanche: '$0.05–$0.30',
    BSC: '$0.05–$0.20',
    Binance: '$0.05–$0.20',
    Tron: '$0.50–$2',
    Berachain: '$0.05–$0.30',
    Sonic: '$0.01–$0.10',
    Hyperliquid: '$0.01–$0.10',
  };
  return table[chain] ?? '$0.05–$0.50';
}

/**
 * The core action a category asks of a farmer. The wording is generic to
 * the category, never to a name: the same Lending steps fit any lending
 * protocol, because the plan is about what the protocol does.
 */
function coreAction(category: string | null): { verb: string; detail: string } {
  const key = (category ?? '').toLowerCase();
  if (key.includes('lend') || key.includes('collateral') || key.includes('cdp')) {
    return {
      verb: 'Supply collateral and borrow against it',
      detail:
        'post the accepted collateral, borrow 30–40% of its value in a stablecoin, and keep the health factor above 1.8 so a dip never liquidates the position',
    };
  }
  if (key.includes('dex') || key.includes('swap') || key.includes('amm')) {
    return {
      verb: 'Provide liquidity and route swaps through the pool',
      detail:
        'add both sides of the deepest pair in equal value, hold the LP position, and run a few swaps through the pool each week so the position earns fees and volume',
    };
  }
  if (key.includes('yield') || key.includes('vault') || key.includes('curator') || key.includes('allocator')) {
    return {
      verb: 'Put capital in the vault and leave it there',
      detail:
        'put the deposit in the highest-TVL vault, leave the position untouched so the yield compounds, and top it up once so the deposit history shows two separate entries',
    };
  }
  if (key.includes('rwa') || key.includes('real world')) {
    return {
      verb: 'Hold the tokenised asset through the protocol',
      detail:
        'buy or mint the asset in the primary market, hold it in the same wallet for the full period, and claim any yield it pays rather than selling it on',
    };
  }
  if (key.includes('bridge') || key.includes('canonical')) {
    return {
      verb: 'Bridge assets through the protocol regularly',
      detail:
        'move a fixed amount on the busiest route once a week, in both directions over time, and keep the destination funds on the new chain for at least a day each time',
    };
  }
  if (key.includes('restak') || key.includes('staking')) {
    return {
      verb: 'Stake and restake through the protocol',
      detail:
        'lock the supported asset in the protocol staking contract, restake the receipt token where the protocol offers it, and leave the stake bonded for the whole period instead of unstaking early',
    };
  }
  if (key.includes('perpetual') || key.includes('deriv') || key.includes('basis')) {
    return {
      verb: 'Trade small, regular positions on the venue',
      detail:
        'open a small long or short with 2–3x leverage, close it within the week, and repeat with a different market so the account shows steady, varied volume',
    };
  }
  if (key.includes('stable') || key.includes('payment')) {
    return {
      verb: 'Use the stablecoin or payment rail for real transfers',
      detail:
        'move the stablecoin in and out through the protocol for genuine payments, keep a balance parked there between transfers, and use the rail at least twice a month',
    };
  }
  if (key.includes('insurance')) {
    return {
      verb: 'Buy cover and keep it active',
      detail:
        'take cover for the largest position the protocol insures, pay the premium up front, and renew it before it lapses so the cover never gaps',
    };
  }
  return {
    verb: 'Use the protocol the way it is built to be used',
    detail:
      'deposit into its main product, run one genuine transaction a week through it, and keep the position open so the wallet builds a continuous history with it',
  };
}

/**
 * A concrete farm plan: 6 steps, each 20–600 characters, each naming what
 * it costs and how long it takes. Steps are built from the protocol's own
 * category, chains and TVL tier, so two protocols in different categories
 * never get the same plan.
 */
export function farmSteps(p: Proto, capital: number): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const second = p.chains[1] ?? null;
  const gas = gasFor(chain);
  const action = coreAction(p.category);
  const cat = p.category ?? 'DeFi';
  const steps: string[] = [
    `Set up a fresh wallet on ${chain} and fund it with $${capital.toLocaleString('en-US')} plus about $25 for gas; one transaction here costs roughly ${gas}, so budget for at least six transactions over the first month.`,
    `${action.verb}: ${action.detail}. Start with half the capital ($${Math.round(capital / 2).toLocaleString('en-US')}) so a mistake on the first transaction never costs the whole position.`,
  ];
  if (second !== null) {
    steps.push(
      `Repeat the core position on ${second}, the protocol's second chain, with the other half of the capital; two chains of activity count for more than twice the size on one, and the bridge itself costs roughly ${gasFor(second)} each way.`,
    );
  } else {
    steps.push(
      `Add the second half of the capital to the same position after 7 days, once the first deposit has settled; a second, later deposit reads as sustained use rather than a single airdrop-hunting transaction.`,
    );
  }
  steps.push(
    `Return once a week for 20 minutes and do one genuine ${cat.toLowerCase()} action — a deposit, a swap, a vote or a claim — so the wallet shows 4–8 weeks of continuous activity instead of a single day of farming.`,
    `Check the position every Sunday for 10 minutes: confirm the health factor or pool share is intact, harvest or compound any yield the protocol pays, and fix anything that drifted before it becomes a loss.`,
    `Watch the protocol's announcements for a points program or token plan, keep the position open until any snapshot it names, and leave 7 days free afterwards to unstake or exit, since exits here typically take 1–7 days.`,
  );
  return steps;
}

/** Parse and minimally validate the sealed snapshot. */
export function parseSnapshot(text: string): Snap {
  const data = JSON.parse(text) as Snap;
  if (!Array.isArray(data.protocols) || !Array.isArray(data.watchlist)) {
    throw new RadarError('snapshot: protocols and watchlist must be arrays');
  }
  if (typeof data.as_of !== 'string' || typeof data.floor_usd !== 'number') {
    throw new RadarError('snapshot: as_of and floor_usd are required');
  }
  return data;
}

/**
 * Build the ranked board: every watchlist protocol, plus the highest
 * implied-value pre-token protocols below the floor, up to 240 rows. The
 * exclusion in isBoardCandidate leaves 198 genuine candidates in this
 * snapshot, so the board holds all of them: the complete universe the
 * radar exists to find, not an arbitrary cut. Ranks are 1..N, implied
 * values strictly non-increasing, ties broken by TVL then slug so the
 * order is deterministic.
 */
export function buildBoard(snap: Snap): {
  rows: PageRow[];
  multiples: CategoryMultiple[];
  live: LivePeer[];
  peerExamples: { category: string; peers: LivePeer[] }[];
} {
  const { byCategory, global } = categoryMultiples(snap.protocols);
  const watched = new Set(snap.watchlist);
  const scored = snap.protocols
    .filter((p) => isBoardCandidate(p))
    .map((p) => {
      const key = p.category ?? 'Uncategorised';
      const entry = byCategory.get(key);
      // The multiple is the category median only when the category has
      // enough priced peers; otherwise it is the global median.
      const basis = entry && entry.peers >= MIN_PEERS ? 'category' : 'global';
      const multiple = entry ? entry.multiple : global;
      const parts = valueParts(p, snap.as_of, multiple, entry ? entry.peers : 0);
      return { p, parts, implied: impliedValue(p, parts), basis };
    })
    .sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  const picked: typeof scored = [];
  const seen = new Set<string>();
  for (const item of scored) {
    if (watched.has(item.p.slug)) {
      picked.push(item);
      seen.add(item.p.slug);
    }
  }
  for (const item of scored) {
    if (picked.length >= BOARD_ROWS) break;
    if (seen.has(item.p.slug)) continue;
    picked.push(item);
    seen.add(item.p.slug);
  }
  picked.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  let prev = Number.POSITIVE_INFINITY;
  const rows: PageRow[] = picked.map((item, i) => {
    const implied = Math.min(item.implied, prev - 1);
    prev = implied;
    const capital = capitalFor(item.p.tvl_usd);
    return {
      slug: item.p.slug,
      name: item.p.name,
      rank: i + 1,
      implied_value_usd: implied,
      farm_steps: farmSteps(item.p, capital),
      category: item.p.category,
      chains: item.p.chains,
      tvl_usd: item.p.tvl_usd,
      change_7d: item.p.change_7d,
      mcap_usd: item.p.mcap_usd,
      listed_at: item.p.listed_at,
      on_watchlist: watched.has(item.p.slug),
      multiple: round6(item.parts.multiple),
      multiple_basis: item.basis,
      peer_count: item.parts.peerCount,
      growth_factor: round6(item.parts.growthFactor),
      maturity_factor: round6(item.parts.maturityFactor),
      breadth_factor: round6(item.parts.breadthFactor),
      age_days: item.parts.ageDays,
      capital_usd: capital,
    };
  });

  const multiples = [...byCategory.values()]
    .filter((m) => m.peers >= 1)
    .sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));

  /**
   * Representative peers per board category: the three tokenised protocols
   * in that category whose mcap/TVL sits closest to the category multiple,
   * so the detail view shows typical peers, not the largest names (a
   * $2.6B mcap on $6M of TVL says nothing about the typical multiple).
   * A category with no priced peers falls back to the three closest to
   * the global median.
   */
  const pricedAll = snap.protocols.filter(
    (p) => !recordsNoToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const closeness = (p: Proto, target: number): number =>
    Math.abs(Math.log(p.mcap_usd! / p.tvl_usd / target));
  const boardCategories = [...new Set(rows.map((r) => r.category ?? 'Uncategorised'))];
  const peerExamples = boardCategories.map((category) => {
    const entry = byCategory.get(category);
    const target = entry ? entry.multiple : global;
    // Examples must illustrate the multiple actually used: the category's
    // own peers only when the category median is the multiple; otherwise
    // the peers closest to the global median.
    const useCategory = entry !== undefined && entry.peers >= MIN_PEERS;
    const inCategory = pricedAll.filter((p) => (p.category ?? 'Uncategorised') === category);
    const pool = useCategory ? inCategory : pricedAll;
    const peers = [...pool]
      .sort((a, b) => closeness(a, target) - closeness(b, target))
      .slice(0, 3)
      .map((p) => ({
        slug: p.slug,
        name: p.name,
        category: p.category,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd!,
        multiple: round6(p.mcap_usd! / p.tvl_usd),
      }));
    return { category, peers };
  });

  const live: LivePeer[] = snap.protocols
    .filter((p) => !recordsNoToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd!)
    .slice(0, LIVE_PEERS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: round6(p.mcap_usd! / p.tvl_usd),
    }));

  return { rows, multiples, live, peerExamples };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** The data the dashboard page renders, as a script the page loads. */
export function packForPage(
  snap: Snap,
  built: {
    rows: PageRow[];
    multiples: CategoryMultiple[];
    live: LivePeer[];
    peerExamples: { category: string; peers: LivePeer[] }[];
  },
): RadarPack {
  const total = built.rows.reduce((sum, r) => sum + r.implied_value_usd, 0);
  return {
    as_of: snap.as_of,
    source: snap.source,
    floor_usd: snap.floor_usd,
    scanned: snap.protocols.length,
    watchlist_size: snap.watchlist.length,
    board_size: built.rows.length,
    total_implied_usd: total,
    model: {
      name: 'Peer-multiple comparables',
      formula: 'implied = TVL × category multiple × growth × maturity × breadth',
      growth_note:
        'Growth: 1 + 0.35 × clamped 7-day TVL change (−60% to +120%), so a hot week lifts value at most 42%.',
      maturity_note:
        'Maturity: 0.85 under 90 days tracked, rising to 1.00 at two years; unknown listing date scores 0.90.',
      breadth_note:
        'Breadth: +2% per extra chain past the first, capped at +10%.',
    },
    categories: built.multiples,
    rows: built.rows,
    live: built.live,
    peer_examples: built.peerExamples,
  };
}

/** Serialise the page pack as a script that sets window.RADAR. */
export function dataScript(pack: RadarPack): string {
  return `window.RADAR = ${JSON.stringify(pack)};\n`;
}

/**
 * The gate's own shape, checked before anything is written: ranks 1..N,
 * implied values non-increasing, every watchlist slug covered, every row's
 * farm steps 3–12 strings of 20–600 characters. Returns the first problem
 * or null.
 */
export function boardIssue(rows: PageRow[], snap: Snap): string | null {
  if (rows.length < 100 || rows.length > 4000) {
    return `board holds ${rows.length} rows, the gate wants 100 to 4000`;
  }
  const slugs = new Set(snap.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (!slugs.has(r.slug)) return `row ${i + 1} names ${r.slug}, which the snapshot does not list`;
    if (seen.has(r.slug)) return `slug ${r.slug} appears twice`;
    seen.add(r.slug);
    if (r.rank !== i + 1) return `row ${i + 1} carries rank ${r.rank}, expected ${i + 1}`;
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `row ${r.slug} has a non-positive or non-whole implied value`;
    }
    if (r.implied_value_usd > prev) return `implied value rises at rank ${r.rank}`;
    prev = r.implied_value_usd;
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `row ${r.slug} carries ${r.farm_steps.length} farm steps, the gate wants 3 to 12`;
    }
    for (const step of r.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${r.slug} has a farm step of ${len} characters`;
    }
  }
  for (const slug of snap.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  return null;
}
