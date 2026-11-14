// Survey question management (dashboard only)
let surveyQuestions = [];
let editingChoices = [];

// Real-time listener for survey questions
function subscribeToSurveyQuestions() {
    if (window.unsubscribeFromSurveyQuestions) {
        window.unsubscribeFromSurveyQuestions();
    }
    window.unsubscribeFromSurveyQuestions = db.collection("surveyQuestions")
        .orderBy("order", "asc")
        .onSnapshot(snapshot => {
            surveyQuestions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderSurveyQuestions();
            if (typeof renderReviewsTab === "function") renderReviewsTab(); // question labels on the Reviews tab
        }, error => {
            console.error("Error listening to survey questions:", error);
        });
}

// A question shows in the customer survey unless it was explicitly hidden
// (older questions have no "visible" field and count as shown).
function isVisible(q) {
    return q.visible !== false;
}

// Questions built into the customer survey (fixed in code, always asked, in this order).
// Listed read-only so admins see the whole survey. `key` = the step name the phone preview jumps to.
const BUILT_IN_QUESTIONS = [
    { key: "branch", question: "Which branch did you visit today?", kind: "Branch picker", note: "Skipped when the customer scans a branch QR code." },
    { key: "ratings", group: true }, // star-rating categories — rendered by ratingGroupCardHtml(), editable
    { key: "atmo-open", question: "What did you like about the atmosphere?", kind: "Stars + text · optional" },
    { key: "comment", question: "Share your detailed feedback", kind: "Review + name · optional" },
    { key: "staff", question: "Who assisted your table?", kind: "Staff picker", note: "Lists the employees of the chosen branch." },
    { key: "staff-rate", question: "How would you rate <staff member>'s service?", kind: "5-star rating · optional", note: "Only asked when a staff member was picked." }
];

// The old hard-coded "manager visit" question, offered once as a normal (editable) question
const MANAGER_SEED_KEY = "managerVisit";
const MANAGER_SEED_DISMISSED = "dpManagerSeedDismissed";
const MANAGER_SEED_QUESTION = {
    question: "Did the manager visit your table?",
    type: "multiple_choice",
    choices: [
        "Yes, the manager personally checked on our table",
        "No, but service was already exceptionally great",
        "No, and we would have appreciated a table visit"
    ]
};

function managerSeedDismissed() {
    try { return localStorage.getItem(MANAGER_SEED_DISMISSED) === "1"; } catch { return false; }
}

function builtInCardHtml(b, number) {
    return `
        <article class="bg-gray-50 border border-dashed border-gray-300 rounded-[10px] px-6 py-3.5">
            <div class="flex items-start justify-between gap-4">
                <div class="flex items-start gap-3 flex-1 min-w-0">
                    <span class="w-7 h-7 rounded-[6px] bg-gray-300 text-gray-700 flex items-center justify-center text-[12px] font-bold shrink-0">${number}</span>
                    <div class="min-w-0">
                        <h3 class="text-[14px] font-bold text-gray-700 break-words">${escapeHtml(b.question)}</h3>
                        <div class="flex items-center gap-3 mt-1.5 flex-wrap">
                            <span class="px-2 py-0.5 rounded-full bg-white border border-gray-200 text-gray-500 text-[10.5px] font-semibold uppercase tracking-[0.04em]">${escapeHtml(b.kind)}</span>
                            <button type="button" data-action="preview-builtin" data-key="${escapeHtml(b.key)}" class="text-[12px] font-semibold text-gray-500 hover:text-gray-900 hover:underline cursor-pointer">Preview</button>
                        </div>
                        ${b.note ? `<p class="text-[11.5px] text-gray-500 mt-1.5">${escapeHtml(b.note)}</p>` : ""}
                    </div>
                </div>
                <span class="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-500" title="Built into the survey — not editable">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path stroke-linecap="round" d="M8 11V7a4 4 0 018 0v4"/></svg>
                    Built-in
                </span>
            </div>
        </article>`;
}

// ---------- Star-rating group ("Please rate the following items") ----------
let editingRatingTitle = false;

function ratingGroupCardHtml(number) {
    const cats = ratingConfig.categories;
    const iconBtn = (action, id, label, svgPath, extra = "") => `
        <button type="button" data-action="${action}" data-id="${escapeHtml(id)}" ${extra} aria-label="${label}" title="${label}"
                class="p-1 rounded text-gray-400 hover:text-gray-900 hover:bg-white disabled:opacity-25 disabled:cursor-not-allowed transition-colors">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="${svgPath}"/></svg>
        </button>`;

    const titleBlock = editingRatingTitle ? `
        <div class="flex items-center gap-2 flex-wrap">
            <input id="ratingTitleInput" type="text" maxlength="120" value="${escapeHtml(ratingConfig.title)}"
                   class="flex-1 min-w-[180px] px-3 py-1.5 text-[14px] font-bold border border-gray-300 rounded-[6px] focus:outline-none focus:border-tvRed focus:ring-1 focus:ring-tvRed">
            <button type="button" data-action="rating-title-save" class="px-3 py-1.5 text-[12px] font-semibold text-white bg-tvRed hover:bg-tvRedHover rounded-[6px]">Save</button>
            <button type="button" data-action="rating-title-cancel" class="px-3 py-1.5 text-[12px] font-semibold text-gray-600 hover:text-gray-900">Cancel</button>
        </div>` : `
        <div class="flex items-center gap-2 flex-wrap">
            <h3 class="text-[14px] font-bold text-gray-900 break-words">${escapeHtml(ratingConfig.title)}</h3>
            <button type="button" data-action="rating-title-edit" aria-label="Edit title" title="Edit title" class="p-1 rounded text-gray-400 hover:text-gray-900">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536M4 20h4l10.5-10.5a2.5 2.5 0 00-3.536-3.536L4 16.5V20z"/></svg>
            </button>
        </div>`;

    const rows = cats.map((c, i) => {
        const required = c.id === RATING_REQUIRED_ID;
        return `
            <div class="group flex items-center gap-3 py-2 rounded-[6px] hover:bg-white px-2 -mx-2">
                <span class="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center text-[17px] leading-none shrink-0" aria-hidden="true">${escapeHtml(c.icon)}</span>
                <span class="text-[13.5px] font-medium text-gray-800 min-w-0 break-words">${escapeHtml(c.label)}</span>
                ${required ? '<span class="text-[10.5px] font-semibold text-gray-400 uppercase tracking-[0.04em] shrink-0" title="Dashboard averages are calculated from this one">Required</span>' : ""}
                <div class="ml-auto flex items-center gap-0.5 shrink-0 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity">
                    ${iconBtn("rating-cat-move", c.id, "Move up", "M5 15l7-7 7 7", `data-dir="-1" ${i === 0 ? "disabled" : ""}`)}
                    ${iconBtn("rating-cat-move", c.id, "Move down", "M19 9l-7 7-7-7", `data-dir="1" ${i === cats.length - 1 ? "disabled" : ""}`)}
                    ${iconBtn("rating-cat-edit", c.id, "Edit", "M15.232 5.232l3.536 3.536M4 20h4l10.5-10.5a2.5 2.5 0 00-3.536-3.536L4 16.5V20z")}
                    ${required ? '<span class="w-6"></span>' : iconBtn("rating-cat-delete", c.id, "Delete", "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16")}
                </div>
            </div>`;
    }).join("");

    const full = cats.length >= RATING_MAX_CATEGORIES;
    return `
        <article class="bg-gray-50 border border-dashed border-gray-300 rounded-[10px] px-6 py-4">
            <div class="flex items-start gap-3">
                <span class="w-7 h-7 rounded-[6px] bg-tvRed text-white flex items-center justify-center text-[12px] font-bold shrink-0">${number}</span>
                <div class="flex-1 min-w-0">
                    ${titleBlock}
                    <div class="flex items-center gap-3 mt-1.5 flex-wrap">
                        <span class="px-2 py-0.5 rounded-full bg-white border border-gray-200 text-gray-500 text-[10.5px] font-semibold uppercase tracking-[0.04em]">5-star ratings · one screen</span>
                        <button type="button" data-action="preview-builtin" data-key="ratings" class="text-[12px] font-semibold text-gray-500 hover:text-gray-900 hover:underline cursor-pointer">Preview</button>
                    </div>
                    <div class="mt-3 border-l-2 border-gray-200 pl-4">
                        ${rows}
                        <button type="button" data-action="rating-cat-add" ${full ? "disabled" : ""}
                                class="mt-1 flex items-center gap-3 py-2 text-[13px] font-medium text-gray-500 hover:text-tvRed disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                            <span class="w-8 h-8 rounded-full bg-white border border-dashed border-gray-300 flex items-center justify-center text-[18px] leading-none">+</span>
                            ${full ? `Maximum of ${RATING_MAX_CATEGORIES} categories` : "Add a new category"}
                        </button>
                    </div>
                </div>
            </div>
        </article>`;
}

async function writeRatingCategories(categories, okMessage) {
    try {
        await saveRatingConfig({ title: ratingConfig.title, categories });
        if (okMessage) showToast(okMessage);
        return true;
    } catch (error) {
        console.error("Error saving rating categories:", error);
        showToast("Couldn't save. Are the latest Firestore rules published?");
        return false;
    }
}

function openRatingCategoryModal(editId = null) {
    const cat = editId ? ratingConfig.categories.find(c => c.id === editId) : null;
    document.getElementById("rcEditId").value = cat ? cat.id : "";
    document.getElementById("rcModalTitle").textContent = cat ? "Edit Rating Category" : "Add Rating Category";
    document.getElementById("rcName").value = cat ? cat.label : "";
    setRatingIcon(cat ? cat.icon : RATING_ICON_CHOICES[0]);
    const m = document.getElementById("ratingCategoryModalBackdrop");
    m.classList.remove("hidden");
    m.classList.add("flex");
    setTimeout(() => document.getElementById("rcName").focus(), 50);
}

function setRatingIcon(icon) {
    document.getElementById("rcIcon").value = icon;
    document.getElementById("rcIconCustom").value = RATING_ICON_CHOICES.includes(icon) ? "" : icon;
    document.querySelectorAll("#rcIconGrid [data-icon]").forEach(b => {
        const on = b.dataset.icon === icon;
        b.classList.toggle("border-tvRed", on);
        b.classList.toggle("bg-red-50", on);
        b.classList.toggle("border-gray-200", !on);
    });
}

async function saveRatingCategoryFromModal(e) {
    e.preventDefault();
    const editId = document.getElementById("rcEditId").value;
    const name = document.getElementById("rcName").value.trim();
    const icon = document.getElementById("rcIcon").value.trim() || "⭐";
    if (!name) return showToast("Please enter a category name.");
    const cats = ratingConfig.categories.map(c => ({ ...c }));
    if (editId) {
        const c = cats.find(x => x.id === editId);
        if (!c) return;
        c.label = name;
        c.icon = icon;
    } else {
        if (cats.length >= RATING_MAX_CATEGORIES) return showToast(`You can have up to ${RATING_MAX_CATEGORIES} categories.`);
        cats.push({ id: ratingCategoryIdFrom(name, cats), label: name, icon });
    }
    const btn = document.getElementById("rcSaveBtn");
    btn.disabled = true;
    const ok = await writeRatingCategories(cats, editId ? `"${name}" updated.` : `"${name}" added.`);
    btn.disabled = false;
    if (ok) {
        const m = document.getElementById("ratingCategoryModalBackdrop");
        m.classList.add("hidden");
        m.classList.remove("flex");
    }
}

function handleRatingGroupAction(action, btn) {
    const id = btn.dataset.id;
    if (action === "rating-title-edit") {
        editingRatingTitle = true;
        renderSurveyQuestions();
        const input = document.getElementById("ratingTitleInput");
        if (input) { input.focus(); input.select(); }
    }
    if (action === "rating-title-cancel") {
        editingRatingTitle = false;
        renderSurveyQuestions();
    }
    if (action === "rating-title-save") {
        const title = document.getElementById("ratingTitleInput").value.trim();
        if (!title) return showToast("The title can't be empty.");
        btn.disabled = true;
        saveRatingConfig({ title, categories: ratingConfig.categories })
            .then(() => { editingRatingTitle = false; showToast("Title updated."); renderSurveyQuestions(); })
            .catch(err => { console.error(err); btn.disabled = false; showToast("Couldn't save. Are the latest Firestore rules published?"); });
    }
    if (action === "rating-cat-add") openRatingCategoryModal();
    if (action === "rating-cat-edit") openRatingCategoryModal(id);
    if (action === "rating-cat-move") {
        const cats = ratingConfig.categories.map(c => ({ ...c }));
        const i = cats.findIndex(c => c.id === id);
        const j = i + Number(btn.dataset.dir);
        if (i < 0 || j < 0 || j >= cats.length) return;
        [cats[i], cats[j]] = [cats[j], cats[i]];
        btn.disabled = true;
        writeRatingCategories(cats);
    }
    if (action === "rating-cat-delete") {
        const c = ratingConfig.categories.find(x => x.id === id);
        if (!c || c.id === RATING_REQUIRED_ID) return;
        if (!confirm(`Delete "${c.label}"?\nCustomers won't be asked this any more. Past ratings are kept.`)) return;
        writeRatingCategories(ratingConfig.categories.filter(x => x.id !== id), `"${c.label}" deleted.`);
    }
}

// Render survey questions list: built-in questions (read-only) first, then the admin's own questions
function renderSurveyQuestions() {
    const listEl = document.getElementById("surveyQuestionsList");
    const emptyEl = document.getElementById("emptySurveyQuestionsState");
    const summaryEl = document.getElementById("surveyQuestionsSummary");
    if (!listEl) return;

    emptyEl.classList.add("hidden"); // the "no questions" message is shown inside the list now

    if (summaryEl) {
        const shown = surveyQuestions.filter(isVisible).length;
        const hidden = surveyQuestions.length - shown;
        summaryEl.textContent = `${BUILT_IN_QUESTIONS.length} built-in (${ratingConfig.categories.length} rating categories) · ` +
            `${surveyQuestions.length} of your own (${shown} shown, ${hidden} hidden)`;
    }

    const sectionTitle = (title, text) => `
        <div class="pt-2 pb-1">
            <h2 class="text-[13px] font-bold text-gray-900 uppercase tracking-[0.05em]">${title}</h2>
            <p class="text-[12px] text-gray-500">${text}</p>
        </div>`;

    const builtInHtml = sectionTitle("Built-in questions", "Always asked first, in this order. You can edit the rating categories; the others are part of the survey itself.")
        + BUILT_IN_QUESTIONS.map((b, i) => (b.group ? ratingGroupCardHtml(i + 1) : builtInCardHtml(b, i + 1))).join("");

    const hasManagerSeed = surveyQuestions.some(q => q.seedKey === MANAGER_SEED_KEY);
    const managerBanner = (!hasManagerSeed && !managerSeedDismissed()) ? `
        <div class="bg-white border-2 border-dashed border-tvRed/50 rounded-[10px] px-6 py-4">
            <p class="text-[14px] font-bold text-gray-900">"Did the manager visit your table?" is now a normal question</p>
            <p class="text-[12.5px] text-gray-600 mt-1">It's no longer built in, so you can edit, reorder, hide or delete it. Add it back with its original 3 answers. It goes last, just like before.</p>
            <div class="flex items-center gap-3 mt-3">
                <button type="button" data-action="add-manager-question" class="px-4 py-2 text-[12.5px] font-semibold text-white bg-tvRed hover:bg-tvRedHover rounded-[6px] transition-colors disabled:opacity-60">Add it as a question</button>
                <button type="button" data-action="dismiss-manager-question" class="text-[12.5px] font-semibold text-gray-500 hover:text-gray-900">I don't need it</button>
            </div>
        </div>` : "";

    // Survey numbers: built-ins are 1..9, then each SHOWN question of yours continues the count
    let nextNumber = BUILT_IN_QUESTIONS.length;
    const numberFor = q => (isVisible(q) ? ++nextNumber : "–");

    const customHeader = sectionTitle("Your questions", "Asked after the built-in ones, in this order. The last one gets the Submit button.");
    const emptyCustom = `
        <div class="bg-white border border-gray-200 rounded-[10px] p-8 text-center">
            <h3 class="text-[15px] font-bold text-gray-900">No questions of your own yet</h3>
            <p class="text-[12px] text-gray-500 mt-1">Click <strong>+ Add Question</strong> to add one.</p>
        </div>`;

    listEl.innerHTML = builtInHtml + customHeader + managerBanner + (surveyQuestions.length === 0 ? emptyCustom : surveyQuestions.map((q, idx) => {
        const number = numberFor(q);
        const visible = isVisible(q);
        const typeBadge = q.type === "open_ended"
            ? '<span class="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[10.5px] font-semibold uppercase tracking-[0.04em]">Open-Ended</span>'
            : '<span class="px-2 py-0.5 rounded-full bg-gray-100 text-tvRed text-[10.5px] font-semibold uppercase tracking-[0.04em]">Multiple Choice</span>';

        const choicesHtml = q.type === "multiple_choice" && Array.isArray(q.choices)
            ? q.choices.map(c => `<span class="px-2 py-0.5 rounded-[4px] bg-gray-100 text-gray-600 text-[11px] font-medium">${escapeHtml(c)}</span>`).join("")
            : "";

        return `
            <article class="bg-white border border-gray-200 rounded-[10px] px-6 py-4 hover:border-gray-300 transition-colors">
                <div class="flex items-start justify-between gap-4">
                    <div class="flex items-start gap-3 flex-1 min-w-0 ${visible ? "" : "opacity-60"}">
                        <span class="w-7 h-7 rounded-[6px] ${visible ? "bg-tvRed" : "bg-gray-400"} text-white flex items-center justify-center text-[12px] font-bold shrink-0">
                            ${number}
                        </span>
                        <div class="min-w-0">
                            <h3 class="text-[14px] font-bold text-gray-900 break-words">${escapeHtml(q.question)}</h3>
                            <div class="flex items-center gap-3 mt-1.5 flex-wrap">
                                ${typeBadge}
                                ${visible ? "" : '<span class="px-2 py-0.5 rounded-full bg-gray-200 text-gray-600 text-[10.5px] font-semibold uppercase tracking-[0.04em]">Hidden from survey</span>'}
                                <button type="button" data-action="edit-question" data-id="${escapeHtml(q.id)}" class="text-[12px] font-semibold text-tvRed hover:underline cursor-pointer">
                                    Edit
                                </button>
                                <button type="button" data-action="preview-question" data-id="${escapeHtml(q.id)}" class="text-[12px] font-semibold text-gray-500 hover:text-gray-900 hover:underline cursor-pointer">
                                    Preview
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <div class="flex flex-col">
                            <button type="button" data-action="move-question" data-dir="-1" data-id="${escapeHtml(q.id)}" ${idx === 0 ? "disabled" : ""} aria-label="Move up" title="Move up"
                                    class="p-0.5 text-gray-400 hover:text-gray-900 disabled:opacity-25 disabled:cursor-not-allowed transition-colors">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7"/></svg>
                            </button>
                            <button type="button" data-action="move-question" data-dir="1" data-id="${escapeHtml(q.id)}" ${idx === surveyQuestions.length - 1 ? "disabled" : ""} aria-label="Move down" title="Move down"
                                    class="p-0.5 text-gray-400 hover:text-gray-900 disabled:opacity-25 disabled:cursor-not-allowed transition-colors">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                            </button>
                        </div>
                        <button type="button" role="switch" aria-checked="${visible}" data-action="toggle-visible" data-id="${escapeHtml(q.id)}"
                                title="${visible ? "Shown in the customer survey — click to hide" : "Hidden from the customer survey — click to show"}"
                                class="inline-flex items-center gap-2 cursor-pointer group">
                            <span class="relative inline-flex h-5 w-9 rounded-full transition-colors ${visible ? "bg-tvRed" : "bg-gray-300"}">
                                <span class="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${visible ? "left-[18px]" : "left-0.5"}"></span>
                            </span>
                            <span class="text-[12px] font-semibold w-[44px] text-left ${visible ? "text-tvRed" : "text-gray-500"}">${visible ? "Shown" : "Hidden"}</span>
                        </button>
                        <button type="button" data-action="delete-question" data-id="${escapeHtml(q.id)}" aria-label="Delete question" class="text-gray-400 hover:text-tvRed transition-colors cursor-pointer p-1">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        </button>
                    </div>
                </div>
                ${choicesHtml ? `<div class="flex flex-wrap gap-1.5 mt-3 pl-10">${choicesHtml}</div>` : ""}
            </article>
        `;
    }).join(""));
}

// Add the former built-in "Did the manager visit your table?" as a normal question (last in the list)
async function addManagerQuestion(btn) {
    if (btn) btn.disabled = true;
    try {
        const maxOrder = surveyQuestions.reduce((m, q) => Math.max(m, Number(q.order) || 0), 0);
        await db.collection("surveyQuestions").add({
            ...MANAGER_SEED_QUESTION,
            visible: true,
            order: maxOrder + 1,
            seedKey: MANAGER_SEED_KEY,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showToast("Manager question added. You can now edit it like any other question.");
    } catch (error) {
        console.error("Error adding manager question:", error);
        showToast("Failed to add the question. Please try again.");
        if (btn) btn.disabled = false;
    }
}

// Open add/edit survey question modal
function openSurveyQuestionModal(editId = null) {
    const modal = document.getElementById("surveyQuestionModalBackdrop");
    const questionInput = document.getElementById("sqQuestion");
    const typeSelect = document.getElementById("sqType");
    const choicesContainer = document.getElementById("sqChoicesContainer");
    const editIdInput = document.getElementById("sqEditId");
    const titleEl = document.getElementById("sqModalTitle");

    if (!modal || !questionInput || !typeSelect || !choicesContainer || !editIdInput) {
        console.error("Survey question modal elements not found");
        return;
    }

    const existing = editId ? surveyQuestions.find(q => q.id === editId) : null;

    editIdInput.value = existing ? existing.id : "";
    questionInput.value = existing ? existing.question : "";
    typeSelect.value = existing ? existing.type : "multiple_choice";
    editingChoices = existing && Array.isArray(existing.choices) ? [...existing.choices] : ["", ""];
    if (titleEl) titleEl.textContent = existing ? "Edit Survey Question" : "Add Survey Question";

    renderChoicesUI();

    modal.classList.remove("hidden");
    modal.classList.add("flex");
    setTimeout(() => questionInput.focus(), 50);
}

// Close survey question modal
function closeSurveyQuestionModal() {
    const modal = document.getElementById("surveyQuestionModalBackdrop");
    if (!modal) return;
    modal.classList.add("hidden");
    modal.classList.remove("flex");
}

// Handle survey question form submission
async function handleAddSurveyQuestion(e) {
    e.preventDefault();

    const question = document.getElementById("sqQuestion").value.trim();
    const type = document.getElementById("sqType").value;
    const editId = document.getElementById("sqEditId").value;

    if (!question) {
        showToast("Please enter a question.");
        return;
    }

    let choices = [];
    if (type === "multiple_choice") {
        choices = editingChoices.map(c => c.trim()).filter(c => c !== "");
        if (choices.length === 0) {
            showToast("Please add at least one choice for multiple choice questions.");
            return;
        }
    }

    try {
        if (editId) {
            // Only change the content; keep the question's position and creation time
            await db.collection("surveyQuestions").doc(editId).update({ question, type, choices });
            showToast("Survey question updated successfully!");
        } else {
            const maxOrder = surveyQuestions.reduce((m, q) => Math.max(m, Number(q.order) || 0), 0);
            await db.collection("surveyQuestions").add({
                question,
                type,
                choices,
                visible: true,
                order: maxOrder + 1,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            showToast("Survey question added successfully!");
        }

        closeSurveyQuestionModal();
        editingChoices = [];
    } catch (error) {
        console.error("Error saving survey question:", error);
        showToast("Failed to save survey question. Please try again.");
    }
}

// Delete survey question
async function deleteSurveyQuestion(questionId) {
    if (!confirm("Are you sure you want to delete this question?")) return;

    try {
        await db.collection("surveyQuestions").doc(questionId).delete();
        showToast("Survey question deleted successfully.");
    } catch (error) {
        console.error("Error deleting survey question:", error);
        showToast("Failed to delete question.");
    }
}

// Move a question up (dir = -1) or down (dir = 1). Renumbers the order 1..n in one batch,
// which also tidies any gaps or duplicate numbers left by older edits.
async function moveQuestion(questionId, dir, btn) {
    const list = surveyQuestions.slice(); // already sorted by "order" (the live listener orders it)
    const i = list.findIndex(q => q.id === questionId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];

    if (btn) btn.disabled = true;
    try {
        const batch = db.batch();
        list.forEach((q, idx) => {
            if (q.order !== idx + 1) batch.update(db.collection("surveyQuestions").doc(q.id), { order: idx + 1 });
        });
        await batch.commit();
    } catch (error) {
        console.error("Error reordering questions:", error);
        showToast("Failed to move the question.");
        if (btn) btn.disabled = false;
    }
}

// Show or hide a question in the customer survey (it is kept, not deleted)
async function toggleQuestionVisibility(questionId, btn) {
    const q = surveyQuestions.find(x => x.id === questionId);
    if (!q) return;
    const makeVisible = !isVisible(q);
    if (btn) btn.disabled = true;
    try {
        await db.collection("surveyQuestions").doc(questionId).update({ visible: makeVisible });
        showToast(makeVisible ? "Question shown in the survey." : "Question hidden from the survey.");
    } catch (error) {
        console.error("Error updating question visibility:", error);
        showToast("Failed to update question.");
        if (btn) btn.disabled = false;
    }
}

// Render the choices editor inside the modal
function renderChoicesUI() {
    const container = document.getElementById("sqChoicesContainer");
    const type = document.getElementById("sqType").value;
    if (!container) return;

    if (type !== "multiple_choice") {
        container.innerHTML = `
            <div class="text-[12px] text-gray-500 text-center py-4 bg-gray-50 rounded-[6px] border border-gray-200">
                Open-ended questions allow customers to type free-text answers.
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <label class="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1.5">Choices</label>
        ${editingChoices.map((c, i) => `
            <div class="flex items-center gap-2 mb-2">
                <input type="text" value="${escapeHtml(c)}" placeholder="Choice ${i + 1}" data-choice-index="${i}"
                       class="flex-1 px-3.5 py-2 text-sm border border-gray-300 rounded-[6px] focus:outline-none focus:border-tvRed focus:ring-1 focus:ring-tvRed">
                <button type="button" data-action="remove-choice" data-index="${i}" aria-label="Remove choice" class="text-gray-400 hover:text-tvRed transition-colors cursor-pointer p-1">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
            </div>
        `).join("")}
        <button type="button" data-action="add-choice" class="w-full px-4 py-2 text-[12px] font-semibold text-gray-600 hover:text-gray-900 border border-dashed border-gray-300 rounded-[6px] hover:bg-gray-50 transition-colors cursor-pointer">
            + Add Choice
        </button>
    `;
}

document.addEventListener("DOMContentLoaded", () => {
    const listEl = document.getElementById("surveyQuestionsList");
    if (!listEl) return; // not the dashboard page

    listEl.addEventListener("click", e => {
        const btn = e.target.closest("[data-action]");
        if (!btn || btn.disabled) return;
        if (btn.dataset.action.startsWith("rating-")) return handleRatingGroupAction(btn.dataset.action, btn);
        if (btn.dataset.action === "edit-question") openSurveyQuestionModal(btn.dataset.id);
        if (btn.dataset.action === "delete-question") deleteSurveyQuestion(btn.dataset.id);
        if (btn.dataset.action === "toggle-visible") toggleQuestionVisibility(btn.dataset.id, btn);
        if (btn.dataset.action === "move-question") moveQuestion(btn.dataset.id, Number(btn.dataset.dir), btn);
        if (btn.dataset.action === "preview-question") {
            const q = surveyQuestions.find(x => x.id === btn.dataset.id);
            if (q && !isVisible(q)) {
                showToast("This question is hidden, so customers won't see it. Switch it to Shown to preview it.");
            } else if (typeof window.previewSurveyQuestion === "function") {
                window.previewSurveyQuestion("q:" + btn.dataset.id);
            }
        }
        if (btn.dataset.action === "preview-builtin" && typeof window.previewSurveyQuestion === "function") {
            window.previewSurveyQuestion(btn.dataset.key);
        }
        if (btn.dataset.action === "add-manager-question") addManagerQuestion(btn);
        if (btn.dataset.action === "dismiss-manager-question") {
            try { localStorage.setItem(MANAGER_SEED_DISMISSED, "1"); } catch {}
            renderSurveyQuestions();
        }
    });

    const choicesContainer = document.getElementById("sqChoicesContainer");
    // Keep editingChoices in sync on every keystroke so nothing is lost on submit/re-render
    // Rating category modal: icon grid, custom emoji, save; Enter in the title box saves it
    const iconGrid = document.getElementById("rcIconGrid");
    iconGrid.innerHTML = RATING_ICON_CHOICES.map(ic =>
        `<button type="button" data-icon="${escapeHtml(ic)}" class="w-10 h-10 rounded-[8px] border border-gray-200 hover:border-gray-400 bg-white text-[20px] leading-none flex items-center justify-center transition-colors" aria-label="Icon ${escapeHtml(ic)}">${escapeHtml(ic)}</button>`
    ).join("");
    iconGrid.addEventListener("click", e => {
        const b = e.target.closest("[data-icon]");
        if (b) setRatingIcon(b.dataset.icon);
    });
    document.getElementById("rcIconCustom").addEventListener("input", e => {
        const v = e.target.value.trim();
        if (v) {
            document.getElementById("rcIcon").value = v;
            document.querySelectorAll("#rcIconGrid [data-icon]").forEach(b => {
                b.classList.remove("border-tvRed", "bg-red-50");
                b.classList.add("border-gray-200");
            });
        }
    });
    document.getElementById("ratingCategoryForm").addEventListener("submit", saveRatingCategoryFromModal);
    listEl.addEventListener("keydown", e => {
        if (e.target.id === "ratingTitleInput" && e.key === "Enter") {
            e.preventDefault();
            const save = listEl.querySelector('[data-action="rating-title-save"]');
            if (save) save.click();
        }
        if (e.target.id === "ratingTitleInput" && e.key === "Escape") {
            editingRatingTitle = false;
            renderSurveyQuestions();
        }
    });

    // Rating categories changed (live): redraw the list
    window.onRatingConfigChanged = () => {
        renderSurveyQuestions();
        if (typeof renderReviewsTab === "function") renderReviewsTab(); // category labels on the Reviews tab
    };

    choicesContainer.addEventListener("input", e => {
        const idx = e.target.dataset.choiceIndex;
        if (idx !== undefined) editingChoices[Number(idx)] = e.target.value;
    });
    choicesContainer.addEventListener("click", e => {
        const btn = e.target.closest("[data-action]");
        if (!btn) return;
        if (btn.dataset.action === "add-choice") {
            editingChoices.push("");
            renderChoicesUI();
        }
        if (btn.dataset.action === "remove-choice") {
            editingChoices.splice(Number(btn.dataset.index), 1);
            renderChoicesUI();
        }
    });

    document.getElementById("sqType").addEventListener("change", renderChoicesUI);

    subscribeToSurveyQuestions();
});
