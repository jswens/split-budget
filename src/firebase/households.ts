import { collection, doc, getDocs, onSnapshot, setDoc, updateDoc, writeBatch, type Unsubscribe } from "firebase/firestore";
import { db } from "./app";
import { fromFirestoreData, toFirestoreData } from "../repositories/firestore/converters";
import type { Household, HouseholdConfigVersion, HouseholdMember } from "../domain/types";

export type JoinRequestStatus = "pending" | "approved" | "rejected";

export interface JoinRequest {
  id: string;
  requesterUid: string;
  displayName: string;
  email?: string;
  status: JoinRequestStatus;
  createdAt: string;
  updatedAt: string;
  reviewedByUid?: string;
}

const defaultPoolId = "household-operating";
const defaultAccountId = "joint-checking";
const defaultCategoryId = "household";
const householdStorageKey = "split-budget.householdId";

function householdRef(householdId: string) {
  return doc(db, "households", householdId);
}

function memberRef(householdId: string, uid: string) {
  return doc(db, "households", householdId, "members", uid);
}

function joinRequestRef(householdId: string, uid: string) {
  return doc(db, "households", householdId, "joinRequests", uid);
}

function now() {
  return new Date().toISOString();
}

function makeHouseholdId() {
  return `home-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function displayNameFor(uid: string, displayName?: string | null, email?: string | null) {
  return displayName?.trim() || email?.split("@")[0] || `Member ${uid.slice(0, 6)}`;
}

function mapJoinRequest(snapshot: { id: string; data: () => Record<string, unknown> }) {
  return fromFirestoreData<JoinRequest>({ id: snapshot.id, ...snapshot.data() });
}

export function getStoredHouseholdId() {
  try {
    return window.localStorage.getItem(householdStorageKey) ?? "";
  } catch {
    return "";
  }
}

export function rememberHouseholdId(householdId: string) {
  try {
    window.localStorage.setItem(householdStorageKey, householdId);
  } catch {
    // Private browsing can disable localStorage; the current session still works.
  }
}

export async function createHousehold(user: { uid: string; displayName?: string | null; email?: string | null }, name: string) {
  const householdId = makeHouseholdId();
  const timestamp = now();
  const displayName = displayNameFor(user.uid, user.displayName, user.email);
  const household: Household = {
    id: householdId,
    name: name.trim(),
    currency: "USD",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
    schemaVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const member: HouseholdMember = {
    id: user.uid,
    authUid: user.uid,
    displayName,
    role: "owner",
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const config: HouseholdConfigVersion = {
    id: "config-v1",
    version: 1,
    defaultAllocations: [{ memberId: user.uid, shareBasisPoints: 10000 }],
    monthlyContributions: { [user.uid]: 0 },
    defaultSettlementPoolId: defaultPoolId,
    effectiveFrom: timestamp,
    createdAt: timestamp,
    createdByUid: user.uid,
  };

  const batch = writeBatch(db);
  // The document id is supplied by the path. Keeping the payload limited to
  // the rule-approved fields also keeps the root/member documents consistent
  // with the repository's normal writes.
  batch.set(householdRef(householdId), toFirestoreData({
    name: household.name,
    currency: household.currency,
    timezone: household.timezone,
    schemaVersion: household.schemaVersion,
    createdAt: household.createdAt,
    updatedAt: household.updatedAt,
  }));
  batch.set(memberRef(householdId, user.uid), toFirestoreData({
    authUid: member.authUid,
    displayName: member.displayName,
    role: member.role,
    active: member.active,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  }));
  batch.set(doc(db, "households", householdId, "settlementPools", defaultPoolId), { name: "Household operating", active: true });
  batch.set(doc(db, "households", householdId, "accounts", defaultAccountId), toFirestoreData({ name: "Joint checking", ownerType: "joint", type: "checking", active: true, createdAt: timestamp, updatedAt: timestamp }));
  batch.set(doc(db, "households", householdId, "categories", defaultCategoryId), { name: "Household", type: "expense", active: true });
  batch.set(doc(db, "households", householdId, "configHistory", config.id), toFirestoreData(config));
  batch.set(doc(db, "households", householdId, "config", "current"), toFirestoreData({ versionId: config.id, ...config }));
  await batch.commit();
  rememberHouseholdId(householdId);
  return householdId;
}

export async function requestToJoin(
  householdId: string,
  user: { uid: string; displayName?: string | null; email?: string | null },
) {
  const normalizedId = householdId.trim();
  if (!normalizedId) throw new Error("Enter a household code.");
  const timestamp = now();
  const request: Record<string, unknown> = {
    requesterUid: user.uid,
    displayName: displayNameFor(user.uid, user.displayName, user.email),
    status: "pending" as const,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  if (user.email) request.email = user.email;
  await setDoc(joinRequestRef(normalizedId, user.uid), toFirestoreData(request), { merge: false });
  rememberHouseholdId(normalizedId);
  return normalizedId;
}

export function watchJoinRequest(householdId: string, uid: string, onChange: (request: JoinRequest | null) => void, onError?: (error: Error) => void): Unsubscribe {
  return onSnapshot(joinRequestRef(householdId, uid), (snapshot) => onChange(snapshot.exists() ? mapJoinRequest(snapshot) : null), (error) => onError?.(error));
}

export async function listPendingJoinRequests(householdId: string) {
  const snapshot = await getDocs(collection(db, "households", householdId, "joinRequests"));
  return snapshot.docs.map(mapJoinRequest).filter((request) => request.status === "pending");
}

export async function approveJoinRequest(householdId: string, request: JoinRequest, reviewerUid: string) {
  const timestamp = now();
  const batch = writeBatch(db);
  batch.update(joinRequestRef(householdId, request.requesterUid), toFirestoreData({ status: "approved", reviewedByUid: reviewerUid, updatedAt: timestamp }));
  batch.set(memberRef(householdId, request.requesterUid), toFirestoreData({
    authUid: request.requesterUid,
    displayName: request.displayName,
    role: "member",
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  await batch.commit();
}

export async function rejectJoinRequest(householdId: string, request: JoinRequest, reviewerUid: string) {
  await updateDoc(joinRequestRef(householdId, request.requesterUid), toFirestoreData({ status: "rejected", reviewedByUid: reviewerUid, updatedAt: now() }));
}
