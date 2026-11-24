import {
  decodeWorkbookReport,
  encodeWorkbookReport,
  isDiffOptions,
  isRecord,
  sanitizeDiffOptions,
  type EncodedReport,
} from "./reportEncoding";
import type { SavedComparison, SavedWorkbookSnapshot, WorkbookSnapshot } from "./savedComparisons";

const DATABASE = "diffcheck-workbook-history";
const SUMMARIES = "summaries";
const SNAPSHOTS = "snapshots";
const SOURCES = "sources";
export const WORKBOOK_KEY_PREFIX = "diffcheck:workbook:v1:";

interface SourceReference {
  digest: string;
  name: string;
  type: string;
  lastModified: number;
}

interface SharedSnapshot extends Omit<WorkbookSnapshot, "original" | "modified"> {
  kind: "shared";
  original: SourceReference;
  modified: SourceReference;
}

interface StoredReport extends EncodedReport {
  kind: "result";
}

interface StoredSource {
  blob: Blob;
  references: number;
}

type WorkbookRecord = WorkbookSnapshot | SharedSnapshot | StoredReport;

function isSourceReference(value: unknown): value is SourceReference {
  if (!isRecord(value)) return false;
  return (
    typeof value.digest === "string" &&
    value.digest.length > 0 &&
    typeof value.name === "string" &&
    typeof value.type === "string" &&
    typeof value.lastModified === "number" &&
    Number.isFinite(value.lastModified)
  );
}

function isStoredSource(value: unknown): value is StoredSource {
  return (
    isRecord(value) &&
    value.blob instanceof Blob &&
    typeof value.references === "number" &&
    Number.isSafeInteger(value.references) &&
    value.references > 0
  );
}

function isFileLikeBlob(value: unknown): value is File {
  return value instanceof Blob && typeof (value as File).name === "string";
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("This browser does not provide IndexedDB for workbook saves."));
      return;
    }
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SUMMARIES)) db.createObjectStore(SUMMARIES, { keyPath: "key" });
      if (!db.objectStoreNames.contains(SNAPSHOTS)) db.createObjectStore(SNAPSHOTS);
      if (!db.objectStoreNames.contains(SOURCES)) db.createObjectStore(SOURCES);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Release the connection cleanly if another tab upgrades the schema.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open workbook storage."));
    request.onblocked = () => {
      request.onsuccess = () => request.result.close();
      reject(new Error("Close other Diffcheck tabs and try again."));
    };
  });
}

async function transaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => () => T,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let settled = false;
      let requestError: unknown = null;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      // Capture the original request DOMException (e.g., QuotaExceededError) while tx.error is still null.
      tx.onerror = (event) => {
        const targetError = (event.target as IDBRequest | null)?.error;
        if (targetError) requestError = targetError;
      };
      tx.onabort = () => fail(tx.error ?? requestError ?? new Error("The workbook storage transaction was aborted."));
      let result: () => T;
      try {
        result = run(tx);
      } catch (error) {
        try {
          tx.abort();
        } catch {
          // Transaction may already be inactive.
        }
        fail(error);
        return;
      }
      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        try {
          resolve(result());
        } catch (error) {
          reject(error);
        }
      };
    });
  } finally {
    db.close();
  }
}

export function sanitizeSummary(raw: unknown): SavedComparison | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.key !== "string" || !raw.key.startsWith(WORKBOOK_KEY_PREFIX)) return null;
  if (
    typeof raw.savedAt === "number" &&
    Number.isFinite(new Date(raw.savedAt).getTime()) &&
    typeof raw.originalName === "string" &&
    typeof raw.modifiedName === "string" &&
    (raw.kind === undefined || raw.kind === "result" || raw.kind === "sources")
  ) {
    return {
      key: raw.key,
      savedAt: raw.savedAt,
      originalName: raw.originalName,
      modifiedName: raw.modifiedName,
      ...(raw.kind ? { kind: raw.kind } : {}),
    };
  }
  return { key: raw.key, savedAt: 0, originalName: "Unreadable comparison", modifiedName: "" };
}

export async function listWorkbookHistory(): Promise<SavedComparison[]> {
  const rows = await transaction<unknown[]>([SUMMARIES], "readonly", (tx) => {
    const request = tx.objectStore(SUMMARIES).getAll();
    return () => (Array.isArray(request.result) ? request.result : []);
  });
  return rows.map(sanitizeSummary).filter((entry): entry is SavedComparison => entry !== null);
}

function digestsOf(snapshot: unknown): string[] {
  if (!isRecord(snapshot) || snapshot.kind !== "shared") return [];
  const out = new Set<string>();
  if (isSourceReference(snapshot.original)) out.add(snapshot.original.digest);
  if (isSourceReference(snapshot.modified)) out.add(snapshot.modified.digest);
  return [...out];
}

function restoreSource(ref: SourceReference, sources: Map<string, StoredSource>): File {
  const source = sources.get(ref.digest);
  if (!source) throw new Error(`The saved workbook ${ref.name} is missing or corrupted.`);
  return new File([source.blob], ref.name, { type: ref.type, lastModified: ref.lastModified });
}

function validateInlineSnapshot(record: unknown): WorkbookSnapshot {
  if (
    !isRecord(record) ||
    record.mode !== "sheet" ||
    typeof record.onlyDiffs !== "boolean" ||
    !isDiffOptions(record.options) ||
    !isFileLikeBlob(record.original) ||
    !isFileLikeBlob(record.modified)
  ) {
    throw new Error("This saved workbook comparison is unreadable or corrupted.");
  }
  return {
    mode: "sheet",
    options: sanitizeDiffOptions(record.options),
    onlyDiffs: record.onlyDiffs,
    original: new File([record.original], record.original.name, {
      type: record.original.type,
      lastModified: record.original.lastModified,
    }),
    modified: new File([record.modified], record.modified.name, {
      type: record.modified.type,
      lastModified: record.modified.lastModified,
    }),
  };
}

export async function readWorkbookSnapshot(key: string): Promise<SavedWorkbookSnapshot | undefined> {
  const record = await transaction<WorkbookSnapshot | StoredReport | undefined>([SNAPSHOTS, SOURCES], "readonly", (tx) => {
    const request: IDBRequest<unknown> = tx.objectStore(SNAPSHOTS).get(key);
    const sources = new Map<string, StoredSource>();
    request.onsuccess = () => {
      const snapshot = request.result;
      for (const digest of digestsOf(snapshot)) {
        const source: IDBRequest<unknown> = tx.objectStore(SOURCES).get(digest);
        source.onsuccess = () => {
          if (isStoredSource(source.result)) sources.set(digest, source.result);
        };
      }
    };
    return () => {
      const snapshot = request.result;
      if (snapshot === undefined) return undefined;
      if (!isRecord(snapshot)) {
        throw new Error("This saved workbook comparison is unreadable or corrupted.");
      }
      if (snapshot.kind === "result") {
        return snapshot as unknown as StoredReport;
      }
      if (snapshot.kind === "shared") {
        if (
          snapshot.mode !== "sheet" ||
          typeof snapshot.onlyDiffs !== "boolean" ||
          !isDiffOptions(snapshot.options) ||
          !isSourceReference(snapshot.original) ||
          !isSourceReference(snapshot.modified)
        ) {
          throw new Error("This saved workbook comparison is unreadable or corrupted.");
        }
        return {
          mode: "sheet",
          options: sanitizeDiffOptions(snapshot.options),
          onlyDiffs: snapshot.onlyDiffs,
          original: restoreSource(snapshot.original, sources),
          modified: restoreSource(snapshot.modified, sources),
        };
      }
      if (snapshot.kind !== undefined) {
        throw new Error("This saved workbook comparison uses an unsupported format.");
      }
      return validateInlineSnapshot(snapshot);
    };
  });
  if (record && "kind" in record) {
    return { mode: "sheet", report: await decodeWorkbookReport(record) };
  }
  return record;
}

async function sourceReference(file: File, subtle: SubtleCrypto): Promise<SourceReference> {
  const hash = await subtle.digest("SHA-256", await file.arrayBuffer());
  const digest = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { digest, name: file.name, type: file.type, lastModified: file.lastModified };
}

export async function writeWorkbookSnapshot(entry: SavedComparison, snapshot: SavedWorkbookSnapshot): Promise<void> {
  const files = new Map<string, File>();
  let record: WorkbookRecord;
  if ("report" in snapshot) {
    record = { kind: "result", ...(await encodeWorkbookReport(snapshot.report)) };
  } else if (crypto.subtle) {
    const original = await sourceReference(snapshot.original, crypto.subtle);
    const modified = await sourceReference(snapshot.modified, crypto.subtle);
    files.set(original.digest, snapshot.original);
    files.set(modified.digest, snapshot.modified);
    record = { ...snapshot, kind: "shared", original, modified };
  } else {
    // Web Crypto requires a secure context. Full saves still work on plain HTTP.
    record = snapshot;
  }

  await transaction([SUMMARIES, SNAPSHOTS, SOURCES], "readwrite", (tx) => {
    tx.objectStore(SUMMARIES).add(entry);
    tx.objectStore(SNAPSHOTS).add(record, entry.key);
    const store = tx.objectStore(SOURCES);
    for (const [digest, file] of files) {
      const source: IDBRequest<unknown> = store.get(digest);
      source.onsuccess = () => {
        const current = source.result;
        const next: StoredSource = isStoredSource(current)
          ? { blob: current.blob, references: current.references + 1 }
          : { blob: file, references: 1 };
        store.put(next, digest);
      };
    }
    return () => undefined;
  });
}

export async function deleteWorkbookSnapshot(key: string): Promise<void> {
  await transaction([SUMMARIES, SNAPSHOTS, SOURCES], "readwrite", (tx) => {
    const snapshots = tx.objectStore(SNAPSHOTS);
    const request: IDBRequest<unknown> = snapshots.get(key);
    request.onsuccess = () => {
      // Never let corrupted snapshot metadata abort deletion of SUMMARIES / SNAPSHOTS.
      try {
        const digests = digestsOf(request.result);
        if (digests.length === 0) return;
        const store = tx.objectStore(SOURCES);
        for (const digest of digests) {
          const source: IDBRequest<unknown> = store.get(digest);
          source.onsuccess = () => {
            const current = source.result;
            if (current === undefined) return;
            if (!isStoredSource(current) || current.references <= 1) store.delete(digest);
            else store.put({ blob: current.blob, references: current.references - 1 }, digest);
          };
        }
      } catch {
        // Ignore malformed source references so the corrupted entry can still be deleted.
      }
    };
    tx.objectStore(SUMMARIES).delete(key);
    snapshots.delete(key);
    return () => undefined;
  });
}
