import { useEffect, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import type { JoinRequest } from "../firebase/households";
import { approveJoinRequest, createHousehold, rejectJoinRequest, requestToJoin, watchJoinRequest } from "../firebase/households";
import { CircleAlert, Check, Clock3, Home, UserPlus, X } from "lucide-react";

interface HouseholdOnboardingProps {
  user: User;
  initialHouseholdId?: string;
  error?: string;
  onHouseholdReady: (householdId: string) => void;
}

type Mode = "choice" | "create" | "join" | "pending";

export function HouseholdOnboarding({ user, initialHouseholdId = "", error: initialError = "", onHouseholdReady }: HouseholdOnboardingProps) {
  const [mode, setMode] = useState<Mode>("choice");
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState(initialHouseholdId);
  const [pendingHouseholdId, setPendingHouseholdId] = useState("");
  const [request, setRequest] = useState<JoinRequest | null>(null);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pendingHouseholdId) return undefined;
    return watchJoinRequest(
      pendingHouseholdId,
      user.uid,
      (nextRequest) => {
        setRequest(nextRequest);
        if (nextRequest?.status === "approved") onHouseholdReady(pendingHouseholdId);
      },
      (watchError) => setError(watchError.message),
    );
  }, [onHouseholdReady, pendingHouseholdId, user.uid]);

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Give your household a name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const householdId = await createHousehold(user, name);
      onHouseholdReady(householdId);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create the household.");
    } finally {
      setBusy(false);
    }
  }

  async function submitJoin(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const householdId = await requestToJoin(joinCode, user);
      setPendingHouseholdId(householdId);
      setMode("pending");
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Could not request access.");
    } finally {
      setBusy(false);
    }
  }

  const back = () => {
    setError("");
    setMode("choice");
  };

  return <div className="setup-screen">
    <div className="setup-card onboarding-card">
      <div className="brand-mark large"><Home size={22} /></div>
      <p className="eyebrow">Household setup</p>
      {mode === "choice" && <>
        <h1>Choose your workspace.</h1>
        <p>Signed in as <strong>{user.email ?? user.displayName ?? "your Google account"}</strong>. Create a new household or ask to join one that already exists.</p>
        <div className="onboarding-actions">
          <button className="button primary full" onClick={() => { setError(""); setMode("create"); }}><Home size={16} />Create a household</button>
          <button className="button outline full" onClick={() => { setError(""); setMode("join"); }}><UserPlus size={16} />Join an existing household</button>
        </div>
      </>}
      {mode === "create" && <form onSubmit={submitCreate}>
        <h1>Start a household.</h1>
        <p>Name it something recognizable. You can add another member after the household is created.</p>
        <label className="field"><span>Household name</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Our household" maxLength={80} /></label>
        {error && <div className="form-error"><CircleAlert size={16} />{error}</div>}
        <div className="modal-actions"><button type="button" className="button ghost" onClick={back}>Back</button><button className="button primary" disabled={busy}>{busy ? "Creating…" : "Create household"}</button></div>
      </form>}
      {mode === "join" && <form onSubmit={submitJoin}>
        <h1>Join a household.</h1>
        <p>Ask an existing member for the household code. Your request will stay pending until they approve it.</p>
        <label className="field"><span>Household code</span><input autoFocus value={joinCode} onChange={(event) => setJoinCode(event.target.value)} placeholder="home-AB12CD34" maxLength={80} /></label>
        {error && <div className="form-error"><CircleAlert size={16} />{error}</div>}
        <div className="modal-actions"><button type="button" className="button ghost" onClick={back}>Back</button><button className="button primary" disabled={busy}>{busy ? "Sending…" : "Request access"}</button></div>
      </form>}
      {mode === "pending" && <>
        <h1>{request?.status === "rejected" ? "Request declined." : "Waiting for approval."}</h1>
        <p>{request?.status === "rejected" ? "An existing member declined this request. You can try another household code." : "An existing household member needs to approve your request. This page will update automatically."}</p>
        <div className={`onboarding-status ${request?.status === "rejected" ? "rejected" : "pending"}`}><Clock3 size={18} /><span><strong>{pendingHouseholdId}</strong><small>{request?.status === "rejected" ? "Access not approved" : "Access request pending"}</small></span></div>
        {error && <div className="form-error"><CircleAlert size={16} />{error}</div>}
        <button className="button outline full" onClick={() => { setJoinCode(pendingHouseholdId); setMode("join"); }}>Use another code</button>
      </>}
      {mode !== "choice" && <small>Only active household members can approve access.</small>}
    </div>
  </div>;
}

interface JoinRequestInboxProps {
  householdId: string;
  reviewerUid: string;
  requests: JoinRequest[];
  onChanged: () => Promise<void>;
}

export function JoinRequestInbox({ householdId, reviewerUid, requests, onChanged }: JoinRequestInboxProps) {
  const [busyId, setBusyId] = useState<string>();
  if (!requests.length) return null;

  async function decide(request: JoinRequest, decision: "approve" | "reject") {
    setBusyId(request.id);
    try {
      if (decision === "approve") await approveJoinRequest(householdId, request, reviewerUid);
      else await rejectJoinRequest(householdId, request, reviewerUid);
      await onChanged();
    } finally {
      setBusyId(undefined);
    }
  }

  return <section className="join-inbox" aria-live="polite">
    <div className="join-inbox-heading"><div><p className="eyebrow">Access request</p><h2>{requests.length === 1 ? "Someone wants to join." : `${requests.length} people want to join.`}</h2></div><UserPlus size={20} /></div>
    {requests.map((request) => <div className="join-request" key={request.id}><div className="join-request-person"><span className="avatar">{request.displayName.slice(0, 2).toUpperCase()}</span><span><strong>{request.displayName}</strong><small>{request.email ?? "Google account"}</small></span></div><div className="join-request-actions"><button className="button primary compact" disabled={busyId === request.id} onClick={() => void decide(request, "approve")}><Check size={14} />Approve</button><button className="button ghost compact" disabled={busyId === request.id} onClick={() => void decide(request, "reject")}><X size={14} />Decline</button></div></div>)}
  </section>;
}
