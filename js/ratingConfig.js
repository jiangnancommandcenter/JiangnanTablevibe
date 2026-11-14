// Star-rating categories shown together on one survey screen ("Please rate the following items").
// Stored in Firestore at surveyConfig/ratingCategories and edited on the dashboard's Survey Questions page.
// Shared by the dashboard and the customer survey; each page defines window.onRatingConfigChanged().
//
// Category ids are the keys saved in each review's `ratings` map, so they never change once created.
// "overall" is required: the dashboard averages, sentiment and branch ratings are calculated from it.

const RATING_CONFIG_DOC = { collection: "surveyConfig", id: "ratingCategories" };
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

const RATING_ICON_CHOICES = [
    "⭐", "🍔", "🍜", "🍲", "🥢", "🍣", "🍕", "🍹", "☕", "🍰", "🕯️", "🎶",
    "🧹", "🧑‍🍳", "💁", "🙂", "⏱️", "💰", "🅿️", "🚻", "❄️", "👶", "🌿", "🔥"
];

let ratingConfig = cloneRatingConfig(DEFAULT_RATING_CONFIG);
let ratingConfigLoaded = false;

function cloneRatingConfig(c) {
    return { title: c.title, categories: c.categories.map(x => ({ ...x })) };
}

// Clean up whatever is stored so the pages can rely on the shape
function normalizeRatingConfig(data) {
    if (!data || !Array.isArray(data.categories) || data.categories.length === 0) {
        return cloneRatingConfig(DEFAULT_RATING_CONFIG);
    }
    const seen = new Set();
    const categories = data.categories
        .filter(c => c && typeof c.id === "string" && c.id && !seen.has(c.id) && seen.add(c.id))
        .map(c => ({ id: c.id, label: String(c.label || c.id), icon: String(c.icon || "⭐") }));
    if (!categories.some(c => c.id === RATING_REQUIRED_ID)) {
        categories.unshift({ ...DEFAULT_RATING_CONFIG.categories[0] }); // Overall must always exist
    }
    return {
        title: typeof data.title === "string" && data.title.trim() ? data.title : DEFAULT_RATING_CONFIG.title,
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
    window.unsubscribeFromRatingConfig = db.collection(RATING_CONFIG_DOC.collection).doc(RATING_CONFIG_DOC.id)
        .onSnapshot(snap => {
            ratingConfig = normalizeRatingConfig(snap.exists ? snap.data() : null);
            ratingConfigLoaded = true;
            if (typeof window.onRatingConfigChanged === "function") window.onRatingConfigChanged();
        }, error => {
            // e.g. rules not published yet: keep the defaults so the survey still works
            console.warn("Rating categories: using defaults (" + (error.code || error.message) + ")");
            ratingConfigLoaded = true;
            if (typeof window.onRatingConfigChanged === "function") window.onRatingConfigChanged();
        });
}

// Dashboard: save the whole config (admins only — enforced by the Firestore rules)
function saveRatingConfig(next) {
    return db.collection(RATING_CONFIG_DOC.collection).doc(RATING_CONFIG_DOC.id).set({
        title: next.title,
        categories: next.categories.map(c => ({ id: c.id, label: c.label, icon: c.icon })),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
}

document.addEventListener("DOMContentLoaded", subscribeToRatingConfig);
