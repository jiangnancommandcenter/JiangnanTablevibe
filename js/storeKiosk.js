// Store redeem kiosk (store.html): branch staff look up and redeem vouchers — nothing else.
// A store account is a Firebase Auth user with a stores/{uid} document { branchId, name }
// (created by hand in the Firebase Console). The branch is locked to the account.
// The Firestore rules let a store: read one voucher at a time (by code or email), list the
// vouchers redeemed at its own branch, and redeem only at its own branch.
// Uses db/escapeHtml (js/firebase-config.js) and the voucher helpers in js/voucherConfig.js.

const auth = firebase.auth();
const LAYOUT_KEY = "tvStoreLayout";            // "pc" | "tablet", per device
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // same as makeVoucherCode() in review.html
const SUCCESS_CLEAR_MS = 8000;

let store = null;          // { uid, branchId, name }
let branchNames = {};      // branchId → name
let mode = "code";         // "code" | "email"
let result = null;         // null | { notFound: true } | { voucher, confirming, redeemed, busy }
let successTimer = null;
let unsubscribeToday = null;
let todayKey = "";

const $ = id => document.getElementById(id);

// ---------- small helpers ----------
function storageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

let toastTimer = null;
function showToast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 4000);
}

// "juan.delacruz@gmail.com" → "ju***@gmail.com"
function maskEmail(email) {
    const s = String(email || "");
    const at = s.indexOf("@");
    if (at < 1) return s ? "***" : "";
    const local = s.slice(0, at);
    return local.slice(0, local.length > 2 ? 2 : 1) + "***" + s.slice(at);
}

function branchName(id) { return branchNames[id] || id || "—"; }
function fmtDate(d) { return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"; }
function fmtTime(d) { return d ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""; }

function show(screen) {
    ["authScreen", "layoutScreen", "kioskScreen"].forEach(id => $(id).classList.toggle("hidden", id !== screen));
}

// ---------- sign in ----------
function showLoginForm() {
    show("authScreen");
    $("authLoading").classList.add("hidden");
    $("notStorePanel").classList.add("hidden");
    $("invitePanel").classList.add("hidden");
    $("loginForm").classList.remove("hidden");
}

function showNotStore(user, status) {
    show("authScreen");
    $("authLoading").classList.add("hidden");
    $("loginForm").classList.add("hidden");
    $("invitePanel").classList.add("hidden");
    $("notStorePanel").classList.remove("hidden");
    $("notStoreEmail").textContent = user.email || user.uid;
    $("notStoreUid").value = user.uid;
    $("notStoreMessage").innerHTML = status === "missing"
        ? "This account has no kiosk access (it may have been revoked). Ask your admin to send an invite from the dashboard's <strong>Account Creation</strong> page."
        : `Couldn't check store access (<code>${escapeHtml(status)}</code>). Make sure the latest Firestore rules are published, then check again.`;
}

// ---------- invite link: create the kiosk account (store.html?invite=<token>) ----------
// The admin's invite (storeInvites/{token}) fixes the email and branch. The account is created with
// that email, then stores/{uid} is written in one batch with the invite marked "active" (single use).
const INVITE_TOKEN = (new URLSearchParams(location.search).get("invite") || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 64);
let inviteMode = !!INVITE_TOKEN;   // while true, sign-in changes don't switch screens
let invite = null;                 // the invite doc
let inviteExisting = false;        // the email already has a Firebase account → sign in instead

function leaveInviteMode() {
    inviteMode = false;
    try { history.replaceState(null, "", location.pathname); } catch { /* ignore */ }
    if (auth.currentUser) handleSignedInUser(auth.currentUser);
    else showLoginForm();
}

function showInviteMessage(title, text, withSignIn) {
    show("authScreen");
    $("authLoading").classList.add("hidden");
    $("loginForm").classList.add("hidden");
    $("notStorePanel").classList.add("hidden");
    $("invitePanel").classList.remove("hidden");
    $("inviteForm").classList.add("hidden");
    $("inviteMessage").innerHTML = `
        <h1 class="text-lg font-bold text-gray-900">${escapeHtml(title)}</h1>
        <p class="text-[13.5px] text-gray-600 mt-1.5">${escapeHtml(text)}</p>
        ${withSignIn ? '<button type="button" id="inviteToLogin" class="mt-5 w-full bg-tvRed hover:bg-tvRedHover text-white font-semibold text-[15px] px-4 py-3 rounded-[8px]">Go to sign in</button>' : ""}`;
    const b = $("inviteToLogin");
    if (b) b.addEventListener("click", leaveInviteMode);
}

async function loadInvite() {
    show("authScreen");
    $("authLoading").classList.remove("hidden");
    try {
        const snap = await db.collection("storeInvites").doc(INVITE_TOKEN).get();
        invite = snap.exists ? { id: snap.id, ...snap.data() } : null;
    } catch (err) {
        console.error("Invite lookup failed:", err);
        return showInviteMessage("Couldn't open this invite", "Check the internet connection and open the link again.", false);
    }
    $("authLoading").classList.add("hidden");
    if (!invite) return showInviteMessage("This invite link isn't valid", "Check that you opened the full link from the email, or ask your admin for a new invite.", true);
    if (invite.status === "active") return showInviteMessage("Password already set", "This link was already used. Sign in with your email and password.", true);
    if (invite.status === "revoked") return showInviteMessage("This invite was cancelled", "Ask your admin to send a new invite.", true);
    const exp = invite.expiresAt && invite.expiresAt.toDate ? invite.expiresAt.toDate() : null;
    if (exp && exp < new Date()) return showInviteMessage("This invite link expired", "Ask your admin to resend the invite from the dashboard.", true);

    $("inviteMessage").innerHTML = "";
    $("invitePanel").classList.remove("hidden");
    $("inviteForm").classList.remove("hidden");
    $("inviteBranch").textContent = invite.branchName || invite.branchId;
    $("inviteEmail").value = invite.email;
    $("invitePassword").focus();
}

function setInviteExisting() {
    inviteExisting = true;
    $("invitePasswordLabel").textContent = "Password of your existing account";
    $("invitePasswordHint").textContent = "This email already has an account. Enter its password to link it to this branch.";
    $("invitePassword").setAttribute("autocomplete", "current-password");
    $("inviteConfirmBox").classList.add("hidden");
    $("inviteSubmitBtn").textContent = "Sign in & link account";
}

$("inviteForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (!invite) return;
    const errEl = $("inviteError");
    const btn = $("inviteSubmitBtn");
    const pw = $("invitePassword").value;
    const showErr = msg => { errEl.textContent = msg; errEl.classList.remove("hidden"); };
    errEl.classList.add("hidden");
    if (!inviteExisting) {
        if (pw.length < 8) return showErr("Use at least 8 characters.");
        if (pw !== $("inviteConfirm").value) return showErr("The passwords don't match.");
    } else if (!pw) return showErr("Enter your password.");

    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = "Saving…";
    try {
        // 1) the Firebase login for this email
        const cur = auth.currentUser;
        if (!cur || (cur.email || "").toLowerCase() !== invite.email) {
            if (inviteExisting) await auth.signInWithEmailAndPassword(invite.email, pw);
            else await auth.createUserWithEmailAndPassword(invite.email, pw);
        }
        // 2) kiosk access + mark the invite used, together (the rules require both)
        const uid = auth.currentUser.uid;
        const batch = db.batch();
        batch.set(db.collection("stores").doc(uid), {
            branchId: invite.branchId,
            name: invite.branchName || invite.branchId,
            email: invite.email,
            inviteId: invite.id,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        batch.update(db.collection("storeInvites").doc(invite.id), {
            status: "active",
            uid,
            usedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await batch.commit();
        showToast("Password saved. Welcome!");
        leaveInviteMode();
    } catch (err) {
        console.error("Account creation failed:", err);
        btn.disabled = false;
        btn.textContent = label;
        if (err.code === "auth/email-already-in-use") { setInviteExisting(); return showErr("This email already has an account. Enter its password below."); }
        const messages = {
            "auth/weak-password": "Choose a stronger password (at least 8 characters).",
            "auth/invalid-credential": "Incorrect password.",
            "auth/wrong-password": "Incorrect password.",
            "auth/too-many-requests": "Too many attempts. Try again in a few minutes.",
            "auth/network-request-failed": "Network error. Check your connection.",
            "auth/operation-not-allowed": "Email/password sign-up is turned off in Firebase. Ask your admin.",
            "permission-denied": "This invite can't be used any more (expired, cancelled or already used). Ask your admin for a new one."
        };
        showErr(messages[err.code] || `Couldn't save your password (${err.code || "error"}).`);
    }
});

$("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const errEl = $("loginError");
    const btn = $("loginSubmitBtn");
    errEl.classList.add("hidden");
    btn.disabled = true;
    btn.textContent = "Signing in…";
    try {
        await auth.signInWithEmailAndPassword($("loginEmail").value.trim(), $("loginPassword").value);
    } catch (err) {
        const messages = {
            "auth/invalid-credential": "Incorrect email or password.",
            "auth/invalid-email": "That email address isn't valid.",
            "auth/user-disabled": "This account has been disabled.",
            "auth/too-many-requests": "Too many attempts. Try again in a few minutes.",
            "auth/network-request-failed": "Network error. Check your connection."
        };
        errEl.textContent = messages[err.code] || `Sign-in failed (${err.code || "unknown error"}).`;
        errEl.classList.remove("hidden");
    }
    btn.disabled = false;
    btn.textContent = "Sign in";
});

let authCheckSeq = 0;
async function handleSignedInUser(user) {
    const seq = ++authCheckSeq;
    let status, data;
    try {
        const snap = await db.collection("stores").doc(user.uid).get();
        data = snap.exists ? snap.data() : null;
        status = data && typeof data.branchId === "string" && data.branchId ? "store" : "missing";
    } catch (err) {
        console.warn("Store check failed:", err.code, err.message);
        status = err.code || "unknown-error";
    }
    if (seq !== authCheckSeq) return;
    if (status !== "store") return showNotStore(user, status);

    store = { uid: user.uid, branchId: data.branchId, name: data.name || "" };
    await loadBranchNames();
    $("branchLabel").textContent = branchName(store.branchId);
    subscribeToday();
    const layout = storageGet(LAYOUT_KEY);
    if (layout === "pc" || layout === "tablet") startKiosk(layout);
    else show("layoutScreen");
}

async function loadBranchNames() {
    try {
        const snap = await db.collection("branches").get();
        branchNames = {};
        snap.forEach(doc => { branchNames[doc.id] = (doc.data() || {}).name || doc.id; });
    } catch (err) {
        console.warn("Branches not loaded:", err.code, err.message);
    }
}

if (inviteMode) loadInvite();

auth.onAuthStateChanged(user => {
    if (inviteMode) return; // the invite screen stays until the account is set up (or left)
    if (user) return handleSignedInUser(user);
    authCheckSeq++;
    store = null;
    if (unsubscribeToday) { unsubscribeToday(); unsubscribeToday = null; }
    clearResult();
    $("loginPassword").value = "";
    showLoginForm();
});

$("signOutBtn").addEventListener("click", () => auth.signOut());
$("notStoreSignOutBtn").addEventListener("click", () => auth.signOut());
$("recheckStoreBtn").addEventListener("click", async e => {
    const btn = e.currentTarget;
    if (!auth.currentUser) return showLoginForm();
    btn.disabled = true;
    await handleSignedInUser(auth.currentUser);
    btn.disabled = false;
});
$("copyUidBtn").addEventListener("click", async () => {
    const input = $("notStoreUid");
    try { await navigator.clipboard.writeText(input.value); }
    catch { input.select(); document.execCommand("copy"); }
    showToast("UID copied.");
});

// ---------- layout ----------
function startKiosk(layout) {
    document.body.dataset.layout = layout;
    show("kioskScreen");
    setMode(mode);
    render();
}

document.querySelectorAll("[data-layout-choice]").forEach(btn => {
    btn.addEventListener("click", () => {
        storageSet(LAYOUT_KEY, btn.dataset.layoutChoice);
        startKiosk(btn.dataset.layoutChoice);
    });
});
$("changeLayoutBtn").addEventListener("click", () => show("layoutScreen"));

function isTablet() { return document.body.dataset.layout === "tablet"; }

// ---------- find ----------
function setMode(next) {
    mode = next;
    document.querySelectorAll(".mode-tab").forEach(t => {
        const on = t.dataset.mode === mode;
        t.className = "mode-tab px-4 py-2 rounded-[8px] text-[14px] font-semibold " +
            (on ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800");
        t.setAttribute("aria-selected", on ? "true" : "false");
    });
    $("codeBox").classList.toggle("hidden", mode !== "code");
    $("emailBox").classList.toggle("hidden", mode !== "email");
    // Tablet: the on-screen keypad types the code, so don't pop up the device keyboard
    $("codeInput").setAttribute("inputmode", isTablet() ? "none" : "text");
    render();
    focusInput();
}

function focusInput() {
    if (result) return;
    const el = mode === "code" ? $("codeInput") : $("emailInput");
    if (!isTablet() || mode === "email") el.focus();
}

document.querySelectorAll(".mode-tab").forEach(t => t.addEventListener("click", () => {
    clearResult();
    setMode(t.dataset.mode);
}));

$("codeInput").addEventListener("input", e => {
    const el = e.target;
    el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
});

$("findForm").addEventListener("submit", e => { e.preventDefault(); findVoucher(); });

document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || $("kioskScreen").classList.contains("hidden")) return;
    clearResult(true);
});

// One email can have several vouchers (one per survey): show a usable one first (active and not
// expired), then any active one (older vouchers have no expiresAt), otherwise any (so staff see
// "already redeemed" / "expired"). One doc per query (store rules allow limit(1) only).
let expiryIndexMissing = false; // the first query needs a composite index (see firestore.indexes.json)
async function findVoucherByEmail(rawEmail) {
    const vouchersRef = db.collection("vouchers");
    // Older vouchers were stored with the address exactly as typed (lowercased)
    const emails = [...new Set([canonicalEmail(rawEmail), rawEmail])];
    if (!expiryIndexMissing) {
        const now = firebase.firestore.Timestamp.now();
        for (const email of emails) {
            try {
                const usable = await vouchersRef.where("email", "==", email).where("status", "==", "active")
                    .where("expiresAt", ">", now).limit(1).get();
                if (!usable.empty) return usable.docs[0];
            } catch (err) {
                if (err.code !== "failed-precondition") throw err;
                // Index not created yet: the link to create it is in this error (browser console, F12)
                console.warn("Voucher lookup by email needs a Firestore index. Open this link to create it:", err.message);
                expiryIndexMissing = true;
                break;
            }
        }
    }
    for (const email of emails) {
        const active = await vouchersRef.where("email", "==", email).where("status", "==", "active").limit(1).get();
        if (!active.empty) return active.docs[0];
    }
    for (const email of emails) {
        const any = await vouchersRef.where("email", "==", email).limit(1).get();
        if (!any.empty) return any.docs[0];
    }
    return null;
}

async function findVoucher() {
    if (!store) return;
    let code = "", email = "";
    if (mode === "code") {
        code = $("codeInput").value.toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (code.length !== 8) { showToast("Type all 8 characters of the voucher code."); return; }
    } else {
        email = $("emailInput").value.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast("Type the customer's full email address."); return; }
    }
    setFinding(true);
    try {
        const doc = mode === "code"
            ? (await db.collection("vouchers").where("code", "==", code).limit(1).get()).docs[0]
            : await findVoucherByEmail(email);
        result = doc ? { voucher: { id: doc.id, ...doc.data() }, confirming: false, redeemed: false, busy: false } : { notFound: true };
    } catch (err) {
        console.error("Voucher lookup failed:", err);
        showToast(err.code === "permission-denied"
            ? "Not allowed to look up vouchers. Ask an admin to publish the latest Firestore rules."
            : "Couldn't search. Check the internet connection and try again.");
    }
    setFinding(false);
    render();
}

function setFinding(on) {
    ["findBtn", "findBtnTablet"].forEach(id => { $(id).disabled = on; });
    const key = document.querySelector('[data-key="find"]');
    if (key) key.disabled = on;
}

// Back to an empty field, ready for the next customer
function clearResult(focus) {
    clearTimeout(successTimer);
    result = null;
    $("codeInput").value = "";
    $("emailInput").value = "";
    if (store) render();
    if (focus) focusInput();
}

// ---------- redeem ----------
async function redeem() {
    const v = result && result.voucher;
    if (!v || result.busy) return;
    if (voucherState(v) !== "Active") { render(); return; }
    result.busy = true;
    render();
    try {
        await db.collection("vouchers").doc(v.id).update({
            status: "redeemed",
            redeemedAt: firebase.firestore.FieldValue.serverTimestamp(),
            redeemedBy: auth.currentUser.uid,
            redeemedBranchId: store.branchId
        });
        // Staff may have cleared the screen (Escape) while this was saving: don't bring the card back
        if (!result || !result.voucher || result.voucher.id !== v.id) return;
        result = { voucher: { ...v, status: "redeemed", redeemedBranchId: store.branchId, redeemedAt: null }, redeemed: true };
        clearTimeout(successTimer);
        successTimer = setTimeout(() => clearResult(true), SUCCESS_CLEAR_MS);
    } catch (err) {
        console.error("Redeem failed:", err);
        showToast(err.code === "permission-denied"
            ? "Can't redeem: this voucher was already used or has expired."
            : "Couldn't redeem. Check the internet connection and try again.");
        if (!result || !result.voucher || result.voucher.id !== v.id) return; // screen was cleared meanwhile
        result.busy = false;
        result.confirming = false;
        // Reload it so the card shows the real status
        try {
            const snap = await db.collection("vouchers").doc(v.id).get();
            if (snap.exists && result && result.voucher && result.voucher.id === v.id) result.voucher = { id: snap.id, ...snap.data() };
        } catch { /* keep what we have */ }
    }
    render();
}

$("resultArea").addEventListener("click", e => {
    const btn = e.target.closest("[data-act]");
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (act === "ask" && result && result.voucher) { result.confirming = true; render(); }
    else if (act === "cancel" && result) { result.confirming = false; render(); }
    else if (act === "confirm") redeem();
    else if (act === "next") clearResult(true);
});

// ---------- keypad (tablet) ----------
function buildKeypad() {
    const keyCls = "kiosk-key flex-1 min-w-0 h-[60px] rounded-[10px] text-[22px] font-bold transition-colors disabled:opacity-50";
    const charKey = ch => `<button type="button" data-key="${ch}" class="${keyCls} font-mono bg-gray-100 active:bg-gray-300 text-gray-900">${ch}</button>`;
    // QWERTY order. Full 1–0 number row (0 and 1 never appear in a code, but staff expect them);
    // letters a code never uses (I, L, O) are left out.
    const rows = [
        "1234567890".split("").map(charKey),
        "QWERTYUP".split("").map(charKey),
        "ASDFGHJK".split("").map(charKey),
        [...("ZXCVBNM".split("").map(charKey)),
            `<button type="button" data-key="back" aria-label="Delete" class="${keyCls} bg-gray-200 active:bg-gray-300 text-gray-700">⌫</button>`],
        [`<button type="button" data-key="clear" class="${keyCls} !flex-[3] bg-gray-200 active:bg-gray-300 text-gray-700 text-[17px]">Clear</button>`,
            `<button type="button" data-key="find" class="${keyCls} !flex-[5] bg-tvRed active:bg-tvRedHover text-white text-[18px]">Find voucher</button>`]
    ];
    $("keypad").innerHTML = rows.map(r => `<div class="flex gap-2">${r.join("")}</div>`).join("");
}

$("keypad").addEventListener("click", e => {
    const btn = e.target.closest("[data-key]");
    if (!btn || btn.disabled) return;
    const input = $("codeInput");
    const k = btn.dataset.key;
    if (k === "back") input.value = input.value.slice(0, -1);
    else if (k === "clear") input.value = "";
    else if (k === "find") findVoucher();
    else if (input.value.length < 8) input.value += k;
});

// ---------- render ----------
function render() {
    const tablet = isTablet();
    // Keypad only in tablet + code mode, and hidden while a voucher card is showing
    $("keypad").style.display = tablet && mode === "code" && !result ? "" : "none";
    $("findBtnTablet").style.display = tablet && mode === "email" && !result ? "" : "none";
    $("findBtn").style.display = !tablet && !result ? "" : "none";
    $("resultArea").innerHTML = resultHtml();
}

function resultHtml() {
    if (!result) return "";
    const big = isTablet();
    if (result.notFound) {
        return `
            <div class="rounded-[14px] border-2 border-gray-200 bg-gray-50 p-6 text-center">
                <p class="text-[20px] font-bold text-gray-900">No voucher found</p>
                <p class="text-[14px] text-gray-500 mt-1">Check the ${mode === "code" ? "code" : "email"} and try again.</p>
                <button type="button" data-act="next" class="mt-5 px-6 py-3 rounded-[10px] bg-tvDark text-white text-[15px] font-bold">Try again</button>
            </div>`;
    }
    const v = result.voucher;
    const deal = voucherDeal(v);

    if (result.redeemed) {
        return `
            <div class="rounded-[16px] bg-green-600 text-white p-7 text-center">
                <svg class="w-16 h-16 mx-auto" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6.5"/></svg>
                <p class="text-[26px] font-extrabold mt-3">Redeemed</p>
                <p class="text-[18px] font-semibold mt-1">Apply ${escapeHtml(deal.pct)}% off ${escapeHtml(deal.applies)}</p>
                <p class="text-[14px] text-green-100 mt-1">${escapeHtml(minSpendLine(deal.min || 0, deal.applies))}</p>
                <p class="font-mono text-[16px] tracking-[0.2em] mt-3 text-green-100">${escapeHtml(v.code || "")}</p>
                <button type="button" data-act="next" class="mt-6 px-8 py-3.5 rounded-[12px] bg-white text-green-700 text-[16px] font-bold">Next customer</button>
            </div>`;
    }

    const state = voucherState(v);
    const exp = voucherExpiry(v);
    const pill = { Active: "bg-green-600 text-white", Redeemed: "bg-gray-800 text-white", Expired: "bg-gray-400 text-white" }[state];
    const redeemedAt = v.redeemedAt && v.redeemedAt.toDate ? v.redeemedAt.toDate() : null;

    let footer;
    if (state === "Redeemed") {
        footer = `
            <div class="rounded-[12px] bg-red-50 border border-red-200 p-4 text-tvRed">
                <p class="text-[17px] font-bold">Already used — do not apply the discount</p>
                <p class="text-[13.5px] mt-0.5">Redeemed ${redeemedAt ? escapeHtml(fmtDate(redeemedAt) + " " + fmtTime(redeemedAt)) : ""} at ${escapeHtml(branchName(v.redeemedBranchId))}.</p>
            </div>
            <button type="button" data-act="next" class="mt-4 w-full py-3.5 rounded-[12px] bg-tvDark text-white text-[16px] font-bold">Next customer</button>`;
    } else if (state === "Expired") {
        footer = `
            <div class="rounded-[12px] bg-red-50 border border-red-200 p-4 text-tvRed">
                <p class="text-[17px] font-bold">Expired — do not apply the discount</p>
                <p class="text-[13.5px] mt-0.5">This voucher was valid until ${escapeHtml(fmtDate(exp))}.</p>
            </div>
            <button type="button" data-act="next" class="mt-4 w-full py-3.5 rounded-[12px] bg-tvDark text-white text-[16px] font-bold">Next customer</button>`;
    } else if (result.confirming) {
        footer = `
            <div class="rounded-[12px] bg-amber-50 border border-amber-200 p-4">
                <p class="text-[16px] font-bold text-gray-900">Check before redeeming</p>
                <p class="text-[14px] text-gray-700 mt-1">Ask the customer to show the voucher email sent to <strong>${escapeHtml(maskEmail(v.email || v.id))}</strong>. It can only be used once.</p>
            </div>
            <div class="grid grid-cols-2 gap-3 mt-4">
                <button type="button" data-act="cancel" class="py-4 rounded-[12px] bg-gray-100 text-gray-800 text-[17px] font-bold" ${result.busy ? "disabled" : ""}>Cancel</button>
                <button type="button" data-act="confirm" class="py-4 rounded-[12px] bg-tvRed hover:bg-tvRedHover text-white text-[17px] font-bold disabled:opacity-60" ${result.busy ? "disabled" : ""}>${result.busy ? "Redeeming…" : "Confirm redeem"}</button>
            </div>`;
    } else {
        footer = `
            <button type="button" data-act="ask" class="w-full ${big ? "py-6 text-[24px]" : "py-5 text-[20px]"} rounded-[14px] bg-tvRed hover:bg-tvRedHover text-white font-extrabold tracking-wide shadow-sm">REDEEM</button>
            <button type="button" data-act="next" class="mt-3 w-full py-3 rounded-[12px] text-gray-600 hover:bg-gray-100 text-[15px] font-semibold">Cancel</button>`;
    }

    return `
        <div class="rounded-[16px] border-2 ${state === "Active" ? "border-green-600" : "border-gray-300"} p-5 sm:p-6">
            <div class="flex items-center justify-between gap-3 flex-wrap">
                <span class="font-mono text-[24px] font-bold tracking-[0.2em] text-gray-900">${escapeHtml(v.code || "")}</span>
                <span class="px-3 py-1 rounded-full text-[13px] font-bold ${pill}">${state}</span>
            </div>
            <p class="${big ? "text-[30px]" : "text-[26px]"} font-extrabold text-tvRed leading-tight mt-3">${escapeHtml(deal.pct)}% off ${escapeHtml(deal.applies)}</p>
            <dl class="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 text-[14px]">
                <div><dt class="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Minimum spend</dt><dd class="font-semibold text-gray-900">${deal.min ? escapeHtml(formatPeso(deal.min)) : "None"}</dd></div>
                <div><dt class="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Valid until</dt><dd class="font-semibold text-gray-900">${escapeHtml(fmtDate(exp))}</dd></div>
                <div><dt class="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Sent to</dt><dd class="font-semibold text-gray-900 break-all">${escapeHtml(maskEmail(v.email || v.id))}</dd></div>
            </dl>
            <div class="mt-5">${footer}</div>
        </div>`;
}

// ---------- today's redemptions (this branch) ----------
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

function subscribeToday() {
    if (unsubscribeToday) unsubscribeToday();
    const start = startOfToday();
    todayKey = start.toDateString();
    $("todayDate").textContent = start.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) + " · " + branchName(store.branchId);
    unsubscribeToday = db.collection("vouchers")
        .where("redeemedBranchId", "==", store.branchId)
        .where("redeemedAt", ">=", firebase.firestore.Timestamp.fromDate(start))
        .orderBy("redeemedAt", "desc")
        .onSnapshot(snap => renderToday(snap.docs.map(d => ({ id: d.id, ...d.data() }))), err => {
            console.error("Today's redemptions:", err);
            // A missing index error includes a link that creates it (open the browser console)
            $("todayList").innerHTML = `<li class="py-3 text-[13px] text-tvRed">${err.code === "failed-precondition"
                ? "Needs a one-time Firestore index. An admin should open the browser console (F12) and click the link in the error."
                : "Couldn't load today's list."}</li>`;
        });
}

function renderToday(list) {
    $("todayCount").textContent = list.length;
    $("todayList").innerHTML = list.length
        ? list.map(v => {
            const at = v.redeemedAt && v.redeemedAt.toDate ? v.redeemedAt.toDate() : new Date();
            return `
                <li class="py-3 flex items-center justify-between gap-3">
                    <div class="min-w-0">
                        <div class="font-mono text-[15px] font-bold tracking-[0.12em] text-gray-900">${escapeHtml(v.code || "")}</div>
                        <div class="text-[12.5px] text-gray-500 truncate">${escapeHtml(voucherDeal(v).text)}</div>
                    </div>
                    <span class="text-[13px] font-semibold text-gray-600 tabular-nums shrink-0">${escapeHtml(fmtTime(at))}</span>
                </li>`;
        }).join("")
        : '<li class="py-6 text-center text-[13px] text-gray-400">No vouchers redeemed yet today.</li>';
}

// Clock + roll the "today" list over at midnight
function tick() {
    $("clockLabel").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (store && startOfToday().toDateString() !== todayKey) subscribeToday();
}

buildKeypad();
tick();
setInterval(tick, 30000);
// Firebase never answered (offline, blocked): show the form anyway
setTimeout(() => { if (!inviteMode && !auth.currentUser && !$("authLoading").classList.contains("hidden")) showLoginForm(); }, 8000);
