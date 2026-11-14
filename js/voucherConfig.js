// Voucher offer settings (discount, what it applies to, minimum spend, validity, on/off).
// Stored in Firestore at surveyConfig/voucher and edited on the dashboard's Vouchers page.
// Shared by the dashboard and the customer survey; each page may define window.onVoucherConfigChanged().
//
// The Firestore rules check every new voucher against this same doc (and fall back to the
// same defaults while the doc doesn't exist), so the survey can't hand out a different deal.
// Each voucher stores its own deal + expiry, so changing these never affects vouchers already sent.

const VOUCHER_CONFIG_DOC = { collection: "surveyConfig", id: "voucher" };
const VOUCHER_UNITS = ["days", "weeks", "months"];
const VOUCHER_UNIT_MAX = { days: 365, weeks: 52, months: 12 };

// Keep in sync with voucherCfg() defaults in firestore.rules
const DEFAULT_VOUCHER_CONFIG = {
    enabled: true,
    discountPercent: 15,
    appliesTo: "Ala Carte Items",
    minSpend: 1000,
    validityValue: 1,
    validityUnit: "months"
};

let voucherConfig = { ...DEFAULT_VOUCHER_CONFIG };
let voucherConfigLoaded = false;

function clampInt(v, min, max, fallback) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

// Clean up whatever is stored so the pages can rely on the shape
function normalizeVoucherConfig(data) {
    const d = data || {};
    const D = DEFAULT_VOUCHER_CONFIG;
    const unit = VOUCHER_UNITS.includes(d.validityUnit) ? d.validityUnit : D.validityUnit;
    return {
        enabled: typeof d.enabled === "boolean" ? d.enabled : D.enabled,
        discountPercent: clampInt(d.discountPercent, 1, 100, D.discountPercent),
        appliesTo: typeof d.appliesTo === "string" && d.appliesTo.trim() ? d.appliesTo.trim().slice(0, 60) : D.appliesTo,
        minSpend: clampInt(d.minSpend, 0, 1000000, D.minSpend),
        validityValue: clampInt(d.validityValue, 1, VOUCHER_UNIT_MAX[unit], D.validityValue),
        validityUnit: unit
    };
}

// Last valid moment of a voucher created at `from`: the end of that day after the validity period.
// Months are calendar months, clamped to the month's last day (31 Jan + 1 month → 28/29 Feb).
function voucherExpiryFrom(from, cfg) {
    const c = cfg || voucherConfig;
    let r;
    if (c.validityUnit === "months") {
        r = new Date(from.getFullYear(), from.getMonth() + c.validityValue, 1);
        const lastDay = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
        r.setDate(Math.min(from.getDate(), lastDay));
    } else {
        const days = c.validityUnit === "weeks" ? c.validityValue * 7 : c.validityValue;
        r = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
    }
    r.setHours(23, 59, 59, 999); // valid through the whole last day
    return r;
}

function formatVoucherDate(d) { // "14 Nov 2026"
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatPeso(n) { // "₱1,000"
    return "₱" + Number(n || 0).toLocaleString("en-PH");
}

function validityLabel(cfg) { // "1 month", "2 weeks", "10 days"
    const c = cfg || voucherConfig;
    const unit = c.validityValue === 1 ? c.validityUnit.replace(/s$/, "") : c.validityUnit;
    return `${c.validityValue} ${unit}`;
}

// "Minimum spend: ₱1,000 on eligible Ala Carte Items in one receipt" / "No minimum spend"
function minSpendLine(minSpend, appliesTo) {
    return minSpend > 0
        ? `Minimum spend: ${formatPeso(minSpend)} on eligible ${appliesTo} in one receipt`
        : "No minimum spend";
}

function voucherConfigRef() {
    return db.collection(VOUCHER_CONFIG_DOC.collection).doc(VOUCHER_CONFIG_DOC.id);
}

function subscribeToVoucherConfig() {
    if (window.unsubscribeFromVoucherConfig) window.unsubscribeFromVoucherConfig();
    window.unsubscribeFromVoucherConfig = voucherConfigRef().onSnapshot(snap => {
        voucherConfig = normalizeVoucherConfig(snap.exists ? snap.data() : null);
        voucherConfigLoaded = true;
        if (typeof window.onVoucherConfigChanged === "function") window.onVoucherConfigChanged();
    }, error => {
        // e.g. rules not published yet: keep the defaults so the survey still works
        console.warn("Voucher settings: using defaults (" + (error.code || error.message) + ")");
        voucherConfigLoaded = true;
        if (typeof window.onVoucherConfigChanged === "function") window.onVoucherConfigChanged();
    });
}

// Survey: read the very latest settings right before creating a voucher
async function fetchVoucherConfig() {
    const snap = await voucherConfigRef().get();
    voucherConfig = normalizeVoucherConfig(snap.exists ? snap.data() : null);
    return voucherConfig;
}

// Dashboard: save the settings (admins only — enforced by the Firestore rules)
function saveVoucherConfig(next) {
    const c = normalizeVoucherConfig(next);
    return voucherConfigRef().set({ ...c, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
}

document.addEventListener("DOMContentLoaded", subscribeToVoucherConfig);
