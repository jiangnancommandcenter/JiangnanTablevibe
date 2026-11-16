// Star-rating categories shown together on one survey screen ("Please rate the following items").
// Two surveys, each with its own categories (edited on the dashboard's Survey Questions page):
//   dine-in  → Firestore surveyConfig/ratingCategories          (ratingConfig)
//   delivery → Firestore surveyConfig/deliveryRatingCategories  (deliveryRatingConfig)
// Shared by the dashboard and the customer survey; each page defines window.onRatingConfigChanged().
//
// Category ids are the keys saved in each review's `ratings` map, so they never change once created.
// "overall" is required: the dashboard averages, sentiment and branch ratings are calculated from it.

const SURVEY_TYPES = ["dinein", "delivery"];
const RATING_CONFIG_DOCS = { dinein: "ratingCategories", delivery: "deliveryRatingCategories" };
const RATING_CONFIG_COLLECTION = "surveyConfig";
const RATING_REQUIRED_ID = "overall";
const RATING_MAX_CATEGORIES = 10;
const RATING_RESERVED_IDS = ["staffService"]; // used by the staff-rating question

const DEFAULT_RATING_CONFIG = {
    title: "Please rate the following items",
    categories: [
        { id: "overall", label: "Overall Experience", icon: "⭐" },
        { id: "food", label: "Food & Drink", icon: "🍔" },
        { id: "atmosphere", label: "Atmosphere", icon: "🕯️" },
        { id: "service", label: "Service", icon: "🧑‍🍳" }
    ]
};

const DEFAULT_DELIVERY_RATING_CONFIG = {
    title: "Please rate your delivery",
    categories: [
        { id: "overall", label: "Overall Experience", icon: "⭐" },
        { id: "food", label: "Food Taste & Quality", icon: "🍲" },
        { id: "temperature", label: "Food Temperature", icon: "🔥" },
        { id: "packaging", label: "Packaging", icon: "📦" },
        { id: "speed", label: "Delivery Speed", icon: "⏱️" },
        { id: "accuracy", label: "Order Accuracy", icon: "✅" }
    ]
};

const DEFAULT_RATING_CONFIGS = { dinein: DEFAULT_RATING_CONFIG, delivery: DEFAULT_DELIVERY_RATING_CONFIG };

const RATING_ICON_CHOICES = [
    "⭐", "🍔", "🍜", "🍲", "🥢", "🍣", "🍕", "🍹", "☕", "🍰", "🕯️", "🎶",
    "🧹", "🧑‍🍳", "💁", "🙂", "⏱️", "💰", "🅿️", "🚻", "❄️", "👶", "🌿", "🔥",
    "📦", "✅", "🛵"
];

// "delivery" for delivery surveys/questions/submissions, otherwise "dinein" (older data has no field)
function surveyTypeOf(x) {
    return x && x.survey === "delivery" ? "delivery" : "dinein";
}

let ratingConfig = cloneRatingConfig(DEFAULT_RATING_CONFIG);                   // dine-in
let deliveryRatingConfig = cloneRatingConfig(DEFAULT_DELIVERY_RATING_CONFIG);  // delivery
let ratingConfigLoaded = false;

function ratingConfigFor(survey) {
    return survey === "delivery" ? deliveryRatingConfig : ratingConfig;
}

function cloneRatingConfig(c) {
    return { title: c.title, categories: c.categories.map(x => ({ ...x })) };
}

// Clean up whatever is stored so the pages can rely on the shape
function normalizeRatingConfig(data, survey = "dinein") {
    const D = DEFAULT_RATING_CONFIGS[survey] || DEFAULT_RATING_CONFIG;
    if (!data || !Array.isArray(data.categories) || data.categories.length === 0) {
        return cloneRatingConfig(D);
    }
    const seen = new Set();
    const categories = data.categories
        .filter(c => c && typeof c.id === "string" && c.id && !seen.has(c.id) && seen.add(c.id))
        .map(c => ({ id: c.id, label: String(c.label || c.id), icon: String(c.icon || "⭐") }));
    if (!categories.some(c => c.id === RATING_REQUIRED_ID)) {
        categories.unshift({ ...D.categories[0] }); // Overall must always exist
    }
    return {
        title: typeof data.title === "string" && data.title.trim() ? data.title : D.title,
        categories: categories.slice(0, RATING_MAX_CATEGORIES)
    };
}

// "Food & Drink" -> "food-drink"; adds -2, -3 … if taken
function ratingCategoryIdFrom(label, existing) {
    const base = String(label).toLowerCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "category";
    const taken = new Set((existing || []).map(c => c.id).concat(RATING_RESERVED_IDS));
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    return id;
}

function subscribeToRatingConfig() {
    if (window.unsubscribeFromRatingConfig) window.unsubscribeFromRatingConfig();
    const pending = new Set(SURVEY_TYPES);
    const done = survey => {
        pending.delete(survey);
        if (!pending.size) ratingConfigLoaded = true; // both loaded (or failed → defaults)
        if (typeof window.onRatingConfigChanged === "function") window.onRatingConfigChanged();
    };
    const unsubs = SURVEY_TYPES.map(survey =>
        db.collection(RATING_CONFIG_COLLECTION).doc(RATING_CONFIG_DOCS[survey]).onSnapshot(snap => {
            const c = normalizeRatingConfig(snap.exists ? snap.data() : null, survey);
            if (survey === "delivery") deliveryRatingConfig = c; else ratingConfig = c;
            done(survey);
        }, error => {
            // e.g. rules not published yet: keep the defaults so the survey still works
            console.warn(`Rating categories (${survey}): using defaults (${error.code || error.message})`);
            done(survey);
        }));
    window.unsubscribeFromRatingConfig = () => unsubs.forEach(u => u());
}

// Dashboard: save one survey's whole config (admins only — enforced by the Firestore rules)
function saveRatingConfig(next, survey = "dinein") {
    return db.collection(RATING_CONFIG_COLLECTION).doc(RATING_CONFIG_DOCS[survey] || RATING_CONFIG_DOCS.dinein).set({
        title: next.title,
        categories: next.categories.map(c => ({ id: c.id, label: c.label, icon: c.icon })),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
}

document.addEventListener("DOMContentLoaded", subscribeToRatingConfig);
