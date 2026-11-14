// Vouchers (15% thank-you vouchers, one per email, emailed after the survey) — dashboard only.
// Customers create them from the survey page; staff look them up by code or email and redeem once,
// after the customer shows the voucher email on their phone (customers never log in).
// Valid until the end of the same date next month (the date printed in the email).
// The Firestore rules enforce: admin-only list/read, single redeem, max 32 days.

// Same rule as addOneMonth() in review.html (31 Jan → 28/29 Feb)
function addOneMonth(d) {
    const r = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const lastDay = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
    r.setDate(Math.min(d.getDate(), lastDay));
    return r;
}


let vouchers = [];
let vouchersLoaded = false;
let lookedUpVouchers = null; // results of the last "Find" (null = nothing searched yet)

function voucherCreated(v) {
    return v.createdAt && typeof v.createdAt.toDate === "function" ? v.createdAt.toDate() : null;
}

function voucherExpiry(v) {
    const c = voucherCreated(v);
    if (!c) return null;
    const last = addOneMonth(c);
    last.setHours(23, 59, 59, 999); // valid through the whole last day
    return last;
}

function voucherState(v) {
    if (v.status === "redeemed") return "Redeemed";
    const exp = voucherExpiry(v);
    if (exp && exp < new Date()) return "Expired";
    return "Active";
}

function subscribeToVouchers() {
    if (window.unsubscribeFromVouchersFn) window.unsubscribeFromVouchersFn();
    window.unsubscribeFromVouchersFn = db.collection("vouchers")
        .orderBy("createdAt", "desc")
        .limit(50)
        .onSnapshot(snapshot => {
            vouchers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            vouchersLoaded = true;
            // keep an open lookup result in sync (e.g. after redeeming)
            if (lookedUpVouchers) {
                lookedUpVouchers = lookedUpVouchers.map(v => vouchers.find(x => x.id === v.id) || v);
            }
            renderVouchers();
        }, error => {
            console.error("Error listening to vouchers:", error);
            vouchersLoaded = true;
            renderVouchers();
        });
}

function unsubscribeFromVouchers() {
    if (window.unsubscribeFromVouchersFn) {
        window.unsubscribeFromVouchersFn();
        window.unsubscribeFromVouchersFn = null;
    }
    vouchers = [];
    vouchersLoaded = false;
    lookedUpVouchers = null;
}

function populateVoucherBranchSelect() {
    const sel = document.getElementById("voucherRedeemBranch");
    if (!sel) return;
    const current = sel.value || (typeof selectedBranchId !== "undefined" && selectedBranchId !== "All" ? selectedBranchId : "");
    const active = activeBranches();
    sel.innerHTML = active.length
        ? active.map(b => `<option value="${escapeHtml(b.id)}">Redeeming at: ${escapeHtml(b.name)}</option>`).join("")
        : '<option value="">No branches yet</option>';
    if (active.some(b => b.id === current)) sel.value = current;
}

function voucherCardHtml(v) {
    const state = voucherState(v);
    const created = voucherCreated(v);
    const exp = voucherExpiry(v);
    const pill = {
        Active: "bg-tvRed text-white",
        Redeemed: "bg-gray-100 text-gray-600",
        Expired: "bg-gray-100 text-gray-400"
    }[state];
    const redeemedAt = v.redeemedAt && v.redeemedAt.toDate ? v.redeemedAt.toDate() : null;
    const details = [
        `Issued ${created ? created.toLocaleDateString() : "just now"} at ${escapeHtml(v.branchId ? branchName(v.branchId) : "—")}`,
        state === "Redeemed"
            ? `Redeemed ${redeemedAt ? redeemedAt.toLocaleDateString() : ""} at ${escapeHtml(v.redeemedBranchId ? branchName(v.redeemedBranchId) : "—")}`
            : `${state === "Expired" ? "Expired" : "Valid until"} ${exp ? exp.toLocaleDateString() : "—"}`
    ];
    return `
        <article class="bg-white border ${state === "Active" ? "border-gray-200" : "border-gray-200 opacity-70"} rounded-[10px] px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-mono text-[16px] font-bold tracking-[0.15em] text-gray-900">${escapeHtml(v.code || "")}</span>
                    <span class="px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${pill}">${state}</span>
                    <span class="text-[12px] font-semibold text-tvRed">${escapeHtml(String(v.discountPercent || 5))}% off</span>
                </div>
                <p class="text-[12px] text-gray-500 mt-1 break-words">${escapeHtml(v.email || "")}</p>
                <p class="text-[12px] text-gray-500">${details.join(" · ")}</p>
            </div>
            ${state === "Active" ? `
                <button type="button" data-action="redeem-voucher" data-id="${escapeHtml(v.id)}" class="shrink-0 px-4 py-2 rounded-[6px] bg-tvRed hover:bg-tvRedHover text-white text-[12px] font-semibold transition-colors disabled:opacity-50">
                    Redeem
                </button>` : ""}
        </article>
    `;
}

function renderVouchers() {
    const listEl = document.getElementById("vouchersList");
    if (!listEl) return;
    const emptyEl = document.getElementById("emptyVouchersState");
    const summaryEl = document.getElementById("vouchersSummary");
    const resultEl = document.getElementById("voucherLookupResult");

    populateVoucherBranchSelect();

    // Lookup result
    if (lookedUpVouchers === null) {
        resultEl.innerHTML = "";
    } else if (lookedUpVouchers.length === 0) {
        resultEl.innerHTML = '<p class="text-[13px] font-medium text-tvRed">No voucher found. Check the code or email and try again.</p>';
    } else {
        resultEl.innerHTML = `<div class="space-y-[10px]">${lookedUpVouchers.map(voucherCardHtml).join("")}</div>`;
    }

    // Recent list
    if (!vouchersLoaded) {
        listEl.innerHTML = '<p class="text-[13px] text-gray-500">Loading vouchers…</p>';
        emptyEl.classList.add("hidden");
        summaryEl.textContent = "";
        return;
    }
    const counts = { Active: 0, Redeemed: 0, Expired: 0 };
    vouchers.forEach(v => counts[voucherState(v)]++);
    summaryEl.textContent = `${vouchers.length} issued · ${counts.Redeemed} redeemed · ${counts.Active} active · ${counts.Expired} expired` +
        (vouchers.length === 50 ? " (latest 50)" : "");
    emptyEl.classList.toggle("hidden", vouchers.length > 0);
    listEl.innerHTML = vouchers.map(voucherCardHtml).join("");
}

// Find by voucher code (8 characters) or by the customer's email (voucher doc id)
async function findVoucher(rawInput) {
    const input = String(rawInput || "").trim();
    try {
        if (input.includes("@")) {
            const snap = await db.collection("vouchers").doc(input.toLowerCase()).get();
            lookedUpVouchers = snap.exists ? [{ id: snap.id, ...snap.data() }] : [];
        } else {
            const code = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
            if (code.length !== 8) {
                showToast("Type the 8-character voucher code or the customer's email.");
                return;
            }
            const snap = await db.collection("vouchers").where("code", "==", code).get();
            lookedUpVouchers = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }
    } catch (error) {
        console.error("Error finding voucher:", error);
        showToast("Couldn't search vouchers. Are the new Firestore rules published?");
        lookedUpVouchers = null;
    }
    renderVouchers();
}

async function redeemVoucher(id, btn) {
    const v = (lookedUpVouchers || []).concat(vouchers).find(x => x.id === id);
    if (!v) return;
    if (voucherState(v) !== "Active") {
        showToast(`This voucher is ${voucherState(v).toLowerCase()} and can't be used.`);
        return;
    }
    const branchId = document.getElementById("voucherRedeemBranch").value;
    if (!branchId) {
        showToast("Choose the branch you're redeeming at.");
        return;
    }
    // Ownership check at the counter: customers never log in, so staff confirm the email
    if (!confirm(
        `First ask the customer to show the voucher email sent to:\n${v.email}\n\n` +
        `Redeem voucher ${v.code} (${v.discountPercent || 5}% off) at ${branchName(branchId)}?\n` +
        `It can only be used once.`)) return;
    if (btn) btn.disabled = true;
    try {
        await db.collection("vouchers").doc(id).update({
            status: "redeemed",
            redeemedAt: firebase.firestore.FieldValue.serverTimestamp(),
            redeemedBy: firebase.auth().currentUser.uid,
            redeemedBranchId: branchId
        });
        showToast(`Voucher ${v.code} redeemed — apply ${v.discountPercent || 5}% off.`);
    } catch (error) {
        console.error("Error redeeming voucher:", error);
        showToast(error.code === "permission-denied"
            ? "Can't redeem: this voucher was already used or has expired."
            : "Failed to redeem voucher. Please try again.");
        if (btn) btn.disabled = false;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const view = document.getElementById("vouchersView");
    if (!view) return;
    document.getElementById("voucherLookupForm").addEventListener("submit", e => {
        e.preventDefault();
        findVoucher(document.getElementById("voucherCodeInput").value);
    });
    view.addEventListener("click", e => {
        const btn = e.target.closest('[data-action="redeem-voucher"]');
        if (btn && !btn.disabled) redeemVoucher(btn.dataset.id, btn);
    });
});
