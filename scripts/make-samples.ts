/**
 * Generates sample workbooks in ./samples.
 *   bun scripts/make-samples.ts           -> original.xlsx + modified.xlsx (demo pair)
 *   bun scripts/make-samples.ts --large   -> large-original.xlsx + large-modified.xlsx (50k rows)
 */
import { utils, write, type CellObject, type WorkBook } from "xlsx";

type AoaCell = string | number | boolean | Date | CellObject | null;
type Aoa = AoaCell[][];

function book(sheets: Array<{ name: string; aoa: Aoa; merges?: string[] }>): WorkBook {
  const wb = utils.book_new();
  for (const s of sheets) {
    const ws = utils.aoa_to_sheet(s.aoa, { cellDates: true });
    if (s.merges) ws["!merges"] = s.merges.map((r) => utils.decode_range(r));
    utils.book_append_sheet(wb, ws, s.name);
  }
  return wb;
}

async function save(wb: WorkBook, path: string): Promise<void> {
  const buf = write(wb, { type: "buffer", bookType: "xlsx", cellDates: true, compression: true, bookSST: true }) as Buffer;
  await Bun.write(path, buf);
  console.log(`wrote ${path} (${buf.length} bytes)`);
}

/** Deterministic PRNG (mulberry32) so samples are reproducible. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Ada", "Grace", "Alan", "Edsger", "Barbara", "Donald", "Ken", "Margaret", "Linus", "Radia"];
const LAST = ["Lovelace", "Hopper", "Turing", "Dijkstra", "Liskov", "Knuth", "Thompson", "Hamilton", "Torvalds", "Perlman"];

function customers(n: number): Aoa {
  const rand = rng(42);
  const rows: Aoa = [["ID", "Name", "Email", "Signup", "Balance", "Active"]];
  for (let i = 1; i <= n; i++) {
    const first = FIRST[Math.floor(rand() * FIRST.length)]!;
    const last = LAST[Math.floor(rand() * LAST.length)]!;
    rows.push([
      1000 + i,
      `${first} ${last}`,
      `${first}.${last}${i}@example.com`.toLowerCase(),
      new Date(2024, Math.floor(rand() * 12), 1 + Math.floor(rand() * 28)),
      Math.round(rand() * 100000) / 100,
      rand() > 0.2,
    ]);
  }
  return rows;
}

/**
 * Orders sheet with formula totals. Cached values match the formulas, as Excel would save them.
 * `qty` overrides quantities by order id; ids in `discounted` get a "*0.9" formula.
 */
function orders(qty: Record<string, number> = {}, discounted: Set<string> = new Set()): Aoa {
  const rows: Aoa = [["Order", "Qty", "Unit price", "Total"]];
  const items: Array<[string, number, number]> = [
    ["ORD-001", 3, 9.99],
    ["ORD-002", 1, 149.0],
    ["ORD-003", 12, 2.5],
    ["ORD-004", 5, 19.95],
  ];
  let sum = 0;
  items.forEach(([id, baseQty, price], k) => {
    const r = k + 2;
    const q = qty[id] ?? baseQty;
    const factor = discounted.has(id) ? 0.9 : 1;
    const total = Math.round(q * price * factor * 100) / 100;
    sum += total;
    const f = factor === 1 ? `B${r}*C${r}` : `B${r}*C${r}*0.9`;
    rows.push([id, q, price, { t: "n", v: total, f }]);
  });
  rows.push(["Sum", null, null, { t: "n", v: Math.round(sum * 100) / 100, f: `SUM(D2:D${items.length + 1})` }]);
  return rows;
}

async function demoPair(): Promise<void> {
  const base = customers(30);
  const notes: Aoa = [["Release notes"], ["Version", "1.0"], ["Owner", "Data team"], ["Status", "draft"]];
  const summary: Aoa = [
    ["Region", "Revenue"],
    ["North", 1200],
    ["South", 980],
    ["East", 1430],
    ["West", 760],
  ];

  const original = book([
    { name: "Customers", aoa: base },
    { name: "Orders", aoa: orders() },
    { name: "Notes", aoa: notes, merges: ["A1:D1"] },
    { name: "Q1 Summary", aoa: summary },
    { name: "Legacy", aoa: [["Old data"], ["kept for reference"]] },
    { name: "Empty", aoa: [] },
  ]);

  // Customers: edit two cells, insert one row, delete one row.
  const mod = base.map((row) => [...row]);
  mod[5]![2] = "new.address@example.com";
  mod[9]![4] = 4321.5;
  mod.splice(15, 0, [2001, "Radia Perlman", "radia@example.com", new Date(2024, 10, 5), 0, true]);
  mod.splice(22, 1);

  // Orders: ORD-001 quantity 3 → 4; ORD-002 gets a 10% discount formula.
  const modOrders = orders({ "ORD-001": 4 }, new Set(["ORD-002"]));

  const modSummary = summary.map((row) => [...row]);
  modSummary[3]![1] = 1500;

  const modified = book([
    { name: "Orders", aoa: modOrders },
    { name: "Customers", aoa: mod },
    { name: "Notes", aoa: [...notes.slice(0, 3), ["Status", "final"]], merges: ["A1:E1"] },
    { name: "Summary Q1", aoa: modSummary },
    { name: "Empty", aoa: [] },
    { name: "Archive", aoa: [["Archived on", new Date(2025, 0, 31)]] },
  ]);

  await save(original, "samples/original.xlsx");
  await save(modified, "samples/modified.xlsx");
}

async function largePair(): Promise<void> {
  const ROWS = 50_000;
  const COLS = 12;
  const rand = rng(7);
  const header: AoaCell[] = Array.from({ length: COLS }, (_, c) => `Col ${c + 1}`);
  const body: Aoa = [];
  for (let r = 0; r < ROWS; r++) {
    const row: AoaCell[] = [r + 1];
    for (let c = 1; c < COLS; c++) row.push(c % 3 === 0 ? `text-${Math.floor(rand() * 1e6)}` : Math.round(rand() * 1e6) / 100);
    body.push(row);
  }
  const modBody = body.map((row) => [...row]);
  for (let k = 0; k < 200; k++) {
    const r = Math.floor(rand() * ROWS);
    const c = 1 + Math.floor(rand() * (COLS - 1));
    modBody[r]![c] = `changed-${k}`;
  }
  for (let k = 0; k < 50; k++) modBody.splice(Math.floor(rand() * modBody.length), 1);
  for (let k = 0; k < 50; k++) modBody.splice(Math.floor(rand() * modBody.length), 0, [`inserted-${k}`]);

  await save(book([{ name: "Data", aoa: [header, ...body] }]), "samples/large-original.xlsx");
  await save(book([{ name: "Data", aoa: [header, ...modBody] }]), "samples/large-modified.xlsx");
}

if (process.argv.includes("--large")) await largePair();
else await demoPair();
