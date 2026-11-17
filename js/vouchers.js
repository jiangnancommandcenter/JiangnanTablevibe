// Vouchers (thank-you vouchers, one per survey, emailed after the survey) — dashboard only.
// Customers create them from the survey page; staff look them up by code or email and redeem once,
// after the customer shows the voucher email on their phone (customers never log in).
// The offer (discount, applies to, min spend, validity, on/off) is edited in the "Voucher settings"
// card here and stored by js/voucherConfig.js. Each voucher keeps its own deal and expiresAt.
// The Firestore rules enforce: admin-only list/read, single redeem, before expiry.

// voucherDeal / voucherCreated / voucherExpiry / voucherState live in js/voucherConfig.js
// (shared with the store kiosk, store.html).

let vouchers = [];
let vouchersLoaded = false;
let lookedUpVouchers = null; // results of the last "Find" (null = nothing searched yet)

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
                    <span class="text-[12px] font-semibold text-tvRed">${escapeHtml(voucherDeal(v).text)}</span>
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

// Find by voucher code (8 characters) or by the customer's email (all their vouchers)
async function findVoucher(rawInput) {
    const input = String(rawInput || "").trim();
    try {
        if (input.includes("@")) {
            // One email can have several vouchers (one per survey). Older vouchers were
            // stored with the address exactly as typed (lowercased), so search both forms.
            const emails = [...new Set([canonicalEmail(input), input.toLowerCase()])];
            const snaps = await Promise.all(emails.map(e => db.collection("vouchers").where("email", "==", e).get()));
            const byId = new Map();
            snaps.forEach(s => s.docs.forEach(doc => byId.set(doc.id, { id: doc.id, ...doc.data() })));
            lookedUpVouchers = [...byId.values()].sort((a, b) =>
                ((b.createdAt && b.createdAt.toMillis && b.createdAt.toMillis()) || 0) -
                ((a.createdAt && a.createdAt.toMillis && a.createdAt.toMillis()) || 0));
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
    if (!(await confirmDialog({
        tone: "info",
        title: `Redeem voucher ${v.code}?`,
        body: `
            <div class="rounded-[8px] border border-gray-200 bg-gray-50 px-3.5 py-2.5 space-y-1">
                <p class="text-[11px] font-semibold uppercase tracking-[0.04em] text-gray-500">First, ask to see the voucher email sent to</p>
                <p class="font-semibold text-gray-900 break-all">${escapeHtml(v.email)}</p>
            </div>
            <p><strong class="text-gray-900">${escapeHtml(voucherDeal(v).text)}</strong> at <strong class="text-gray-900">${escapeHtml(branchName(branchId))}</strong>.
               It can only be used once.</p>`,
        confirmLabel: "Redeem voucher",
        cancelLabel: "Not yet"
    }))) return;
    if (btn) btn.disabled = true;
    try {
        await db.collection("vouchers").doc(id).update({
            status: "redeemed",
            redeemedAt: firebase.firestore.FieldValue.serverTimestamp(),
            redeemedBy: firebase.auth().currentUser.uid,
            redeemedBranchId: branchId
        });
        showToast(`Voucher ${v.code} redeemed — apply ${voucherDeal(v).pct}% off ${voucherDeal(v).applies}.`);
    } catch (error) {
        console.error("Error redeeming voucher:", error);
        showToast(error.code === "permission-denied"
            ? "Can't redeem: this voucher was already used or has expired."
            : "Failed to redeem voucher. Please try again.");
        if (btn) btn.disabled = false;
    }
}

// ---------- Voucher settings card ----------
let voucherSettingsDirty = false; // don't overwrite what the admin is typing when the doc updates

function readVoucherSettingsForm() {
    return {
        enabled: document.getElementById("vsEnabled").checked,
        discountPercent: Number(document.getElementById("vsDiscount").value),
        appliesTo: document.getElementById("vsAppliesTo").value.trim(),
        minSpend: Number(document.getElementById("vsMinSpend").value),
        validityValue: Number(document.getElementById("vsValidityValue").value),
        validityUnit: document.getElementById("vsValidityUnit").value,
        conditions: [...document.querySelectorAll("#vsConditionsList input")]
            .map(i => i.value.trim())
            .filter(Boolean)
    };
}

const TRASH_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';

function addConditionRow(text) {
    const row = document.createElement("div");
    row.className = "flex gap-2";
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = VOUCHER_CONDITION_MAX_LEN;
    input.value = text;
    input.setAttribute("aria-label", "Condition");
    input.className = "flex-1 min-w-0 px-3 py-2 text-[14px] bg-gray-50 border border-gray-200 rounded-[6px] focus:outline-none focus:bg-white focus:border-tvRed focus:ring-1 focus:ring-tvRed";
    const del = document.createElement("button");
    del.type = "button";
    del.dataset.action = "remove-condition";
    del.title = "Remove condition";
    del.setAttribute("aria-label", "Remove condition");
    del.className = "shrink-0 w-10 flex items-center justify-center rounded-[6px] text-gray-400 hover:text-tvRed hover:bg-gray-50";
    del.innerHTML = TRASH_ICON;
    row.append(input, del);
    document.getElementById("vsConditionsList").appendChild(row);
}

function renderConditionRows(list) {
    document.getElementById("vsConditionsList").innerHTML = "";
    list.forEach(addConditionRow);
}

// "+" / Enter in the "Add a condition" box
function addConditionFromInput() {
    const input = document.getElementById("vsConditionAdd");
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    if (document.querySelectorAll("#vsConditionsList input").length >= VOUCHER_MAX_CONDITIONS) {
        showToast(`At most ${VOUCHER_MAX_CONDITIONS} conditions.`);
        return;
    }
    addConditionRow(text);
    input.value = "";
    input.focus();
    voucherSettingsDirty = true;
    updateVoucherSettingsPreview();
}

function fillVoucherSettingsForm(c) {
    document.getElementById("vsEnabled").checked = c.enabled;
    document.getElementById("vsDiscount").value = c.discountPercent;
    document.getElementById("vsAppliesTo").value = c.appliesTo;
    document.getElementById("vsMinSpend").value = c.minSpend;
    document.getElementById("vsValidityValue").value = c.validityValue;
    document.getElementById("vsValidityUnit").value = c.validityUnit;
    renderConditionRows(c.conditions);
    updateVoucherSettingsPreview();
}

// Returns an error message, or "" when the form is valid
function voucherSettingsError(f) {
    if (!Number.isInteger(f.discountPercent) || f.discountPercent < 1 || f.discountPercent > 100) return "Discount must be a whole number from 1 to 100.";
    if (!f.appliesTo) return "Type what the discount applies to (e.g. Ala Carte Items).";
    if (f.appliesTo.length > 60) return "\"Applies to\" can be at most 60 characters.";
    if (!Number.isInteger(f.minSpend) || f.minSpend < 0 || f.minSpend > 1000000) return "Minimum spend must be a whole number from 0 to 1,000,000 (0 = no minimum).";
    const max = VOUCHER_UNIT_MAX[f.validityUnit];
    if (!Number.isInteger(f.validityValue) || f.validityValue < 1 || f.validityValue > max) return `Validity must be 1 to ${max} ${f.validityUnit}.`;
    if (!f.conditions.length) return "Add at least one condition.";
    if (f.conditions.length > VOUCHER_MAX_CONDITIONS) return `At most ${VOUCHER_MAX_CONDITIONS} conditions.`;
    if (f.conditions.some(c => c.length > VOUCHER_CONDITION_MAX_LEN)) return `Each condition can be at most ${VOUCHER_CONDITION_MAX_LEN} characters.`;
    return "";
}

function updateVoucherSettingsPreview() {
    const f = readVoucherSettingsForm();
    document.getElementById("vsEnabledLabel").textContent = f.enabled ? "On" : "Off";
    const count = document.querySelectorAll("#vsConditionsList input").length;
    document.getElementById("vsConditionAddBtn").disabled = count >= VOUCHER_MAX_CONDITIONS;
    const el = document.getElementById("vsPreview");
    const err = voucherSettingsError(f);
    if (err) {
        el.className = "text-[12.5px] font-medium text-tvRed";
        el.textContent = err;
        return;
    }
    el.className = "text-[12.5px] text-gray-600";
    // Only errors and the "paused" note are shown here
    el.textContent = f.enabled ? "" : "Vouchers are paused: customers can still leave reviews, but no voucher is offered.";
}

async function saveVoucherSettings() {
    const f = readVoucherSettingsForm();
    const err = voucherSettingsError(f);
    if (err) { showToast(err); return; }
    const btn = document.getElementById("vsSaveBtn");
    btn.disabled = true;
    try {
        await saveVoucherConfig(f);
        voucherSettingsDirty = false;
        showToast(f.enabled ? `Voucher settings saved: ${f.discountPercent}% off ${f.appliesTo}.` : "Vouchers paused.");
    } catch (error) {
        console.error("Error saving voucher settings:", error);
        showToast(error.code === "permission-denied"
            ? "Couldn't save: publish the latest Firestore rules first."
            : "Couldn't save voucher settings. Please try again.");
    }
    btn.disabled = false;
}

window.onVoucherConfigChanged = () => {
    if (!voucherSettingsDirty && document.getElementById("voucherSettingsForm")) fillVoucherSettingsForm(voucherConfig);
};

document.addEventListener("DOMContentLoaded", () => {
    const view = document.getElementById("vouchersView");
    if (!view) return;
    const settingsForm = document.getElementById("voucherSettingsForm");
    fillVoucherSettingsForm(voucherConfig);
    settingsForm.addEventListener("input", () => { voucherSettingsDirty = true; updateVoucherSettingsPreview(); });
    settingsForm.addEventListener("change", () => { voucherSettingsDirty = true; updateVoucherSettingsPreview(); });
    settingsForm.addEventListener("submit", e => { e.preventDefault(); saveVoucherSettings(); });
    settingsForm.addEventListener("click", e => {
        const btn = e.target.closest("[data-action]");
        if (!btn) return;
        if (btn.dataset.action === "remove-condition") {
            btn.parentElement.remove();
            voucherSettingsDirty = true;
            updateVoucherSettingsPreview();
        } else if (btn.dataset.action === "add-condition") {
            addConditionFromInput();
        }
    });
    // Enter in "Add a condition" adds it instead of submitting the form
    document.getElementById("vsConditionAdd").addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); addConditionFromInput(); }
    });
    document.getElementById("voucherLookupForm").addEventListener("submit", e => {
        e.preventDefault();
        findVoucher(document.getElementById("voucherCodeInput").value);
    });
    view.addEventListener("click", e => {
        const btn = e.target.closest('[data-action="redeem-voucher"]');
        if (btn && !btn.disabled) redeemVoucher(btn.dataset.id, btn);
    });
});
