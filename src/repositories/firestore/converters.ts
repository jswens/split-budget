import { Timestamp, type DocumentData } from "firebase/firestore";

const timestampKeys = new Set(["createdAt", "updatedAt", "economicDate", "startDate", "endDate", "effectiveFrom", "finalizedAt", "completedAt", "archivedAt", "committedAt"]);

function encode(value: unknown, key?: string): unknown {
  if (value === undefined) return undefined;
  if (typeof value === "string" && key && timestampKeys.has(key)) return Timestamp.fromDate(new Date(value));
  if (Array.isArray(value)) return value.map((item) => encode(item));
  if (value && typeof value === "object" && !(value instanceof Timestamp)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v, k)]));
  return value;
}

function decode(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v)]));
  return value;
}

export function toFirestoreData<T extends object>(value: T): DocumentData { return encode(value) as DocumentData; }
export function fromFirestoreData<T>(value: DocumentData): T { return decode(value) as T; }

