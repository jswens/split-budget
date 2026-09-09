import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "./app";

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

export function signInWithGoogle() { return signInWithPopup(auth, provider); }
export function signOutGoogle() { return signOut(auth); }
export function observeAuth(callback: (user: User | null) => void) { return onAuthStateChanged(auth, callback); }

