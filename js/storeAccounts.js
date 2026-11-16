// Account Creation (dashboard): invite each branch's store to the voucher redeem kiosk (store.html).
// The admin picks a branch + email → an invite doc storeInvites/{token} is created and the link
// store.html?invite=<token> is emailed with EmailJS. The store opens it, picks a password, and its
// kiosk account (stores/{uid}, locked to the branch) is created. One account per branch.
// The Firestore rules make each invite single-use, email-bound and valid for 7 days.

const STORE_INVITE_DAYS = 7;
let storeInvites = [];
let storeInvitesLoaded = false;
let storeInvitesError = "";

function inviteExpiry(inv) {
    return inv.expiresAt && typeof inv.expiresAt.toDate === "function" ? inv.expiresAt.toDate() : null;
}

// "Invited" | "Expired" | "Active" | "Revoked"
function inviteState(inv) {
    if (inv.status === "active") return "Active";
    if (inv.status === "revoked") return "Revoked";
    const exp = inviteExpiry(inv);
    return exp && exp < new Date() ? "Expired" : "Invited";
}

function inviteUrl(token) {
    const url = new URL("store.html", location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("invite", token);
    return url.toString();
}

function makeInviteToken() {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => abc[b % abc.length]).join("");
}

// The invite email can use its own EmailJS service (and account) — see js/firebase-config.js
const inviteServiceId = () => (typeof EMAILJS_STORE_INVITE_SERVICE_ID !== "undefined" && EMAILJS_STORE_INVITE_SERVICE_ID) || EMAILJS_SERVICE_ID;
const invitePublicKey = () => (typeof EMAILJS_STORE_INVITE_PUBLIC_KEY !== "undefined" && EMAILJS_STORE_INVITE_PUBLIC_KEY) || EMAILJS_PUBLIC_KEY;

function inviteEmailEnabled() {
    return typeof emailjs !== "undefined" && !!invitePublicKey() && !!inviteServiceId()
        && typeof EMAILJS_STORE_INVITE_TEMPLATE_ID !== "undefined" && !!EMAILJS_STORE_INVITE_TEMPLATE_ID;
}

// One account per branch: a branch with an invited (even expired) or active account is taken
function branchHasStoreAccount(branchId) {
    return storeInvites.some(inv => inv.branchId === branchId && inv.status !== "revoked");
}

// ---------- live data ----------
function subscribeToStoreInvites() {
    if (window.unsubscribeFromStoreInvitesFn) window.unsubscribeFromStoreInvitesFn();
    window.unsubscribeFromStoreInvitesFn = db.collection("storeInvites").orderBy("createdAt", "desc")
        .onSnapshot(snap => {
            storeInvites = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            storeInvitesLoaded = true;
            storeInvitesError = "";
            renderStoreAccounts();
        }, err => {
            console.error("Store invites:", err);
            storeInvitesLoaded = true;
            storeInvitesError = err.code === "permission-denied"
                ? "Couldn't load accounts. Publish the latest Firestore rules first."
                : "Couldn't load accounts.";
            renderStoreAccounts();
        });
}

function unsubscribeFromStoreInvites() {
    if (window.unsubscribeFromStoreInvitesFn) window.unsubscribeFromStoreInvitesFn();
    window.unsubscribeFromStoreInvitesFn = null;
    storeInvites = [];
    storeInvitesLoaded = false;
}

// ---------- email ----------

async function sendInviteEmail(inv, token) {
    if (!inviteEmailEnabled()) return false;
    const exp = inviteExpiry(inv) || new Date(Date.now() + STORE_INVITE_DAYS * 864e5);
    await emailjs.send(inviteServiceId(), EMAILJS_STORE_INVITE_TEMPLATE_ID, {
        to_email: inv.email,
        branch_name: inv.branchName || branchName(inv.branchId),
        invite_url: inviteUrl(token),
        expires: exp.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    }, { publicKey: invitePublicKey() });
    return true;
}

async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
    }
}

// ---------- actions ----------
async function sendStoreInvite(e) {
    e.preventDefault();
    const branchId = document.getElementById("saBranch").value;
    const email = document.getElementById("saEmail").value.trim().toLowerCase();
    if (!branchId) return showToast("Choose the branch.");
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return showToast("Type a valid email address.");
    if (branchHasStoreAccount(branchId)) return showToast("This branch already has a kiosk account. Revoke it first to invite someone else.");

    const btn = document.getElementById("saSendBtn");
    btn.disabled = true;
    const token = makeInviteToken();
    const expires = new Date(Date.now() + STORE_INVITE_DAYS * 864e5);
    const inv = {
        email,
        branchId,
        branchName: branchName(branchId),
        status: "invited",
        expiresAt: firebase.firestore.Timestamp.fromDate(expires),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        sentAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    try {
        await db.collection("storeInvites").doc(token).set(inv);
    } catch (err) {
        console.error("Invite not created:", err);
        showToast(err.code === "permission-denied" ? "Couldn't create the invite. Publish the latest Firestore rules first." : "Couldn't create the invite. Please try again.");
        btn.disabled = false;
        return;
    }
    document.getElementById("saEmail").value = "";
    try {
        const sent = await sendInviteEmail(inv, token);
        if (sent) showToast(`Invite sent to ${email}.`);
        else {
            await copyText(inviteUrl(token));
            showToast("Invite created. Email isn't set up yet, so the link was copied: send it to the store yourself.");
        }
    } catch (err) {
        console.warn("Invite email failed:", err && (err.text || err.message || err));
        await copyText(inviteUrl(token));
        showToast("Invite created, but the email didn't send. The link was copied: send it to the store yourself.");
    }
    btn.disabled = false;
}

async function resendInvite(inv, btn) {
    btn.disabled = true;
    const expires = new Date(Date.now() + STORE_INVITE_DAYS * 864e5);
    try {
        await db.collection("storeInvites").doc(inv.id).update({
            expiresAt: firebase.firestore.Timestamp.fromDate(expires),
            sentAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        const sent = await sendInviteEmail({ ...inv, expiresAt: firebase.firestore.Timestamp.fromDate(expires) }, inv.id);
        if (sent) showToast(`Invite sent again to ${inv.email}. It's valid for ${STORE_INVITE_DAYS} more days.`);
        else {
            await copyText(inviteUrl(inv.id));
            showToast(`Link renewed for ${STORE_INVITE_DAYS} days and copied (email isn't set up yet).`);
        }
    } catch (err) {
        console.error("Resend failed:", err);
        showToast("Couldn't resend the invite. Please try again.");
    }
    btn.disabled = false;
}

async function sendStoreResetPassword(inv, btn) {
    btn.disabled = true;
    try {
        await firebase.auth().sendPasswordResetEmail(inv.email);
        showToast(`Password reset link sent to ${inv.email}.`);
    } catch (err) {
        console.error("Reset email failed:", err);
        showToast(`Couldn't send the reset email (${err.code || "error"}).`);
    }
    btn.disabled = false;
}

async function revokeStoreAccount(inv, btn) {
    const state = inviteState(inv);
    const msg = state === "Active"
        ? `Revoke kiosk access for ${inv.email} (${inv.branchName || branchName(inv.branchId)})?\nThey won't be able to redeem vouchers any more. You can then invite someone else for this branch.`
        : `Cancel the invite for ${inv.email}?\nThe link will stop working.`;
    if (!confirm(msg)) return;
    btn.disabled = true;
    try {
        const batch = db.batch();
        if (inv.uid) batch.delete(db.collection("stores").doc(inv.uid));
        batch.update(db.collection("storeInvites").doc(inv.id), {
            status: "revoked",
            revokedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await batch.commit();
        showToast(state === "Active" ? "Kiosk access revoked." : "Invite cancelled.");
    } catch (err) {
        console.error("Revoke failed:", err);
        showToast("Couldn't revoke. Are the latest Firestore rules published?");
        btn.disabled = false;
    }
}

async function deleteRevokedInvite(inv, btn) {
    if (!confirm(`Remove ${inv.email} from this list?`)) return;
    btn.disabled = true;
    try { await db.collection("storeInvites").doc(inv.id).delete(); }
    catch (err) { console.error(err); showToast("Couldn't remove it."); btn.disabled = false; }
}

// ---------- render ----------
function renderStoreAccounts() {
    const listEl = document.getElementById("storeAccountsList");
    if (!listEl) return;

    // Branch picker: only branches without an account / pending invite
    const sel = document.getElementById("saBranch");
    const current = sel.value;
    const free = activeBranches().filter(b => !branchHasStoreAccount(b.id));
    sel.innerHTML = free.length
        ? '<option value="">Choose a branch…</option>' + free.map(b => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join("")
        : '<option value="">Every branch already has an account</option>';
    if (free.some(b => b.id === current)) sel.value = current;
    document.getElementById("saSendBtn").disabled = !free.length;
    document.getElementById("saEmailNote").classList.toggle("hidden", inviteEmailEnabled());

    if (!storeInvitesLoaded) { listEl.innerHTML = '<p class="text-[13px] text-gray-500">Loading accounts…</p>'; return; }
    if (storeInvitesError) { listEl.innerHTML = `<p class="text-[13px] font-medium text-tvRed">${escapeHtml(storeInvitesError)}</p>`; return; }

    const counts = { Active: 0, Invited: 0, Expired: 0, Revoked: 0 };
    storeInvites.forEach(inv => counts[inviteState(inv)]++);
    document.getElementById("storeAccountsSummary").textContent =
        `${counts.Active} active · ${counts.Invited} invited · ${counts.Expired} expired`;

    if (!storeInvites.length) {
        listEl.innerHTML = `
            <div class="bg-white border border-gray-200 rounded-[10px] p-10 text-center">
                <h3 class="text-[15px] font-bold text-gray-900">No kiosk accounts yet</h3>
                <p class="text-[12px] text-gray-500 mt-1">Invite a branch above. They'll get an email to set their password.</p>
            </div>`;
        return;
    }

    // Active and pending first, revoked last
    const rank = { Active: 0, Invited: 1, Expired: 2, Revoked: 3 };
    const rows = storeInvites.slice().sort((a, b) => rank[inviteState(a)] - rank[inviteState(b)]);
    const btnCls = "px-3 py-1.5 rounded-[6px] text-[12px] font-semibold transition-colors disabled:opacity-50";
    listEl.innerHTML = rows.map(inv => {
        const state = inviteState(inv);
        const pill = {
            Active: "bg-emerald-50 text-emerald-700 border border-emerald-200",
            Invited: "bg-amber-50 text-amber-700 border border-amber-200",
            Expired: "bg-gray-100 text-gray-500 border border-gray-200",
            Revoked: "bg-gray-100 text-gray-400 border border-gray-200"
        }[state];
        const exp = inviteExpiry(inv);
        const used = inv.usedAt && inv.usedAt.toDate ? inv.usedAt.toDate() : null;
        const detail = {
            Active: `Password set ${used ? used.toLocaleDateString() : ""}`,
            Invited: `Link expires ${exp ? exp.toLocaleDateString() : "—"}`,
            Expired: `Link expired ${exp ? exp.toLocaleDateString() : ""}`,
            Revoked: "Access revoked"
        }[state];
        const id = escapeHtml(inv.id);
        const actions = [];
        if (state === "Invited" || state === "Expired") {
            actions.push(`<button type="button" data-sa="copy" data-id="${id}" class="${btnCls} text-gray-700 bg-gray-100 hover:bg-gray-200">Copy link</button>`);
            actions.push(`<button type="button" data-sa="resend" data-id="${id}" class="${btnCls} text-white bg-tvRed hover:bg-tvRedHover">${state === "Expired" ? "Renew & resend" : "Resend"}</button>`);
        }
        if (state === "Active") {
            actions.push(`<button type="button" data-sa="reset" data-id="${id}" class="${btnCls} text-gray-700 bg-gray-100 hover:bg-gray-200">Send password reset</button>`);
        }
        if (state !== "Revoked") {
            actions.push(`<button type="button" data-sa="revoke" data-id="${id}" class="${btnCls} text-tvRed border border-tvRed/40 hover:bg-red-50">${state === "Active" ? "Revoke access" : "Cancel invite"}</button>`);
        } else {
            actions.push(`<button type="button" data-sa="remove" data-id="${id}" class="${btnCls} text-gray-500 hover:text-gray-900">Remove</button>`);
        }
        return `
            <article class="bg-white border border-gray-200 rounded-[10px] px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${state === "Revoked" ? "opacity-60" : ""}">
                <div class="min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-[14px] font-bold text-gray-900">${escapeHtml(inv.branchName || branchName(inv.branchId))}</span>
                        <span class="px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${pill}">${state}</span>
                    </div>
                    <p class="text-[12.5px] text-gray-600 mt-0.5 break-all">${escapeHtml(inv.email)}</p>
                    <p class="text-[12px] text-gray-400">${escapeHtml(detail)}</p>
                </div>
                <div class="flex flex-wrap gap-2 shrink-0">${actions.join("")}</div>
            </article>`;
    }).join("");
}

document.addEventListener("DOMContentLoaded", () => {
    const view = document.getElementById("accountsView");
    if (!view) return;
    document.getElementById("storeInviteForm").addEventListener("submit", sendStoreInvite);
    view.addEventListener("click", async e => {
        const btn = e.target.closest("[data-sa]");
        if (!btn || btn.disabled) return;
        const inv = storeInvites.find(x => x.id === btn.dataset.id);
        if (!inv) return;
        const act = btn.dataset.sa;
        if (act === "copy") { await copyText(inviteUrl(inv.id)); showToast("Invite link copied."); }
        if (act === "resend") resendInvite(inv, btn);
        if (act === "reset") sendStoreResetPassword(inv, btn);
        if (act === "revoke") revokeStoreAccount(inv, btn);
        if (act === "remove") deleteRevokedInvite(inv, btn);
    });
});
