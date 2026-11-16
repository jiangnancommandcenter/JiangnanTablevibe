// Reviews tab: graphs + every customer's answers, split into small tabs so only one topic shows at a time.
// Read-only. Uses the live data the dashboard already loads:
//   surveySubmissions (js/dashboard.js), ratingConfig (js/ratingConfig.js),
//   surveyQuestions (js/surveyQuestions.js), employees (js/employees.js), branches (js/branches.js).
//
// Charts are plain HTML bars: one colour per chart (brand red), thin marks with a rounded end,
// values printed beside every bar (the tooltip only adds detail), no dual axes.

const REVIEW_TABS = [
    { id: "overview", label: "Overview" },
    { id: "branches", label: "Branches" },
    { id: "suggestions", label: "Suggestions" },
    { id: "staff", label: "Staff" },
    { id: "questions", label: "Your questions" },
    { id: "all", label: "All reviews" }
];
const REVIEW_TAB_KEY = "dpReviewsTab";
const SEARCHABLE_TABS = ["suggestions", "all"];

let activeReviewTab = (() => {
    try { const t = localStorage.getItem(REVIEW_TAB_KEY); return REVIEW_TABS.some(x => x.id === t) ? t : "overview"; }
    catch { return "overview"; }
})();
let selectedPeriodDays = 30;           // 7 | 30 | 90 | 0 (= all time)
let suggestionSource = "all";          // all | comment | atmosphere | question
let suggestionLimit = 50;
const expandedRows = new Set();        // expanded branch / staff rows

// ---------- data helpers ----------
function submissionTime(s) {
    const c = s.createdAt;
    if (c && typeof c.toDate === "function") return c.toDate().getTime();
    if (c && typeof c.seconds === "number") return c.seconds * 1000;
    return Date.now(); // just submitted; the server time hasn't arrived yet
}

function inPeriod(s) {
    return !selectedPeriodDays || submissionTime(s) >= Date.now() - selectedPeriodDays * 864e5;
}

// Branch + period scope (search is applied only where it makes sense: Suggestions & All reviews)
function reviewsInScope({ ignoreBranch = false } = {}) {
    return surveySubmissions.filter(s => inPeriod(s) && matchesSurveyFilter(s) // Dine-in / Delivery filter
        && (ignoreBranch || selectedBranchId === "All" || s.branchId === selectedBranchId));
}

function validStar(v) {
    const n = Number(v);
    return n >= 1 && n <= 5 ? n : null;
}

function average(values) {
    const v = values.filter(x => x !== null && x !== undefined);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

const fmtAvg = v => (v === null ? "—" : v.toFixed(1));
const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);
const fmtDate = ms => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const starsText = n => (n ? "★".repeat(n) + "☆".repeat(5 - n) : "");

function periodLabel() {
    return selectedPeriodDays ? `last ${selectedPeriodDays} days` : "all time";
}

// Rating categories for the current Type filter: dine-in, delivery, or both (dine-in first,
// then the delivery-only ones such as "packaging")
function categoriesInView() {
    if (selectedSurveyFilter === "delivery") return deliveryRatingConfig.categories;
    if (selectedSurveyFilter === "dinein") return ratingConfig.categories;
    const ids = new Set(ratingConfig.categories.map(c => c.id));
    return ratingConfig.categories.concat(deliveryRatingConfig.categories.filter(c => !ids.has(c.id)));
}

// Rating category ids → label/icon (current config + any old ids still in the data).
// survey: look in that survey's categories first ("food" is named differently in each)
function categoryMeta(id, survey) {
    const first = survey === "delivery" ? deliveryRatingConfig : ratingConfig;
    const second = survey === "delivery" ? ratingConfig : deliveryRatingConfig;
    const c = (survey ? first.categories.find(x => x.id === id) : categoriesInView().find(x => x.id === id))
        || second.categories.find(x => x.id === id) || first.categories.find(x => x.id === id);
    return c ? { label: c.label, icon: c.icon, removed: false } : { label: id, icon: "•", removed: true };
}

function questionMeta(qid) {
    return (typeof surveyQuestions !== "undefined" ? surveyQuestions : []).find(q => q.id === qid) || null;
}

// ---------- chart pieces ----------
// Horizontal bar: label | thin bar on a recessive track | value (always printed)
function hBar({ label, icon = "", value, max, valueText, sub = "", tip = "", muted = false }) {
    const w = max > 0 && value > 0 ? Math.max(2, (value / max) * 100) : 0;
    return `
        <div class="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-3 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-tvRed rounded-[4px]"
             tabindex="0" data-tip="${escapeHtml(tip || `${label}: ${valueText}`)}">
            <span class="text-[13px] text-gray-700 truncate">${icon ? `<span aria-hidden="true" class="mr-1.5">${escapeHtml(icon)}</span>` : ""}${escapeHtml(label)}</span>
            <span class="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                <span class="block h-full ${muted ? "bg-gray-300" : "bg-tvRed"} rounded-r-[4px]" style="width:${w.toFixed(1)}%"></span>
            </span>
            <span class="text-[12.5px] font-semibold text-gray-900 whitespace-nowrap">${escapeHtml(valueText)}${sub ? ` <span class="font-normal text-gray-500">${escapeHtml(sub)}</span>` : ""}</span>
        </div>`;
}

function card(title, subtitle, body, extraClass = "") {
    return `
        <section class="bg-white border border-gray-200 rounded-[10px] px-6 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.02)] ${extraClass}">
            <div class="mb-4">
                <h2 class="text-[15px] font-bold text-gray-900">${escapeHtml(title)}</h2>
                ${subtitle ? `<p class="text-[12px] text-gray-500 mt-0.5">${escapeHtml(subtitle)}</p>` : ""}
            </div>
            ${body}
        </section>`;
}

function emptyNote(text) {
    return `<p class="text-[13px] text-gray-500 py-6 text-center">${escapeHtml(text)}</p>`;
}

// Reviews over time: vertical bars (count), auto day/week/month buckets, table view underneath
function timeBuckets(subs) {
    const now = Date.now();
    const firstMs = subs.length ? Math.min(...subs.map(submissionTime)) : now;
    const spanDays = selectedPeriodDays || Math.max(1, Math.ceil((now - firstMs) / 864e5));
    const unit = spanDays <= 14 ? "day" : spanDays <= 7 * 12 ? "week" : "month";

    const startOf = ms => {
        const d = new Date(ms);
        d.setHours(0, 0, 0, 0);
        if (unit === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
        if (unit === "month") d.setDate(1);
        return d.getTime();
    };
    const step = start => {
        const d = new Date(start);
        if (unit === "day") d.setDate(d.getDate() + 1);
        else if (unit === "week") d.setDate(d.getDate() + 7);
        else d.setMonth(d.getMonth() + 1);
        return d.getTime();
    };

    const count = unit === "day" ? Math.min(spanDays, 14) : 12;
    let start = startOf(now);
    const starts = [start];
    for (let i = 1; i < count; i++) {
        const d = new Date(start);
        if (unit === "day") d.setDate(d.getDate() - 1);
        else if (unit === "week") d.setDate(d.getDate() - 7);
        else d.setMonth(d.getMonth() - 1);
        start = d.getTime();
        starts.unshift(start);
    }
    return {
        unit,
        buckets: starts.map(st => {
            const end = step(st);
            const inB = subs.filter(s => { const t = submissionTime(s); return t >= st && t < end; });
            return {
                start: st,
                label: unit === "month" ? new Date(st).toLocaleDateString(undefined, { month: "short" }) : fmtDate(st),
                count: inB.length,
                avg: average(inB.map(s => validStar(s.ratings && s.ratings.overall)))
            };
        })
    };
}

function vBarsChart({ unit, buckets }) {
    const max = Math.max(1, ...buckets.map(b => b.count));
    const maxIdx = buckets.reduce((best, b, i) => (b.count > buckets[best].count ? i : best), 0);
    const last = buckets.length - 1;
    const plotH = 140;
    const showEvery = buckets.length > 8 ? 2 : 1;
    const unitWord = unit === "day" ? "Day" : unit === "week" ? "Week of" : "Month";

    const bars = buckets.map((b, i) => {
        const h = b.count ? Math.max(3, (b.count / max) * (plotH - 22)) : 0;
        const label = (i === maxIdx || i === last) && b.count ? `<span class="text-[11px] font-semibold text-gray-900 mb-1">${b.count}</span>` : "";
        const tip = `${unitWord} ${b.label}: ${b.count} review${b.count === 1 ? "" : "s"}${b.avg !== null ? ` · avg ${b.avg.toFixed(1)}★` : ""}`;
        return `
            <div class="flex-1 min-w-0 h-full flex flex-col justify-end items-center px-[1px] outline-none focus-visible:ring-2 focus-visible:ring-tvRed rounded-[4px]"
                 tabindex="0" data-tip="${escapeHtml(tip)}">
                ${label}
                <span class="block w-full max-w-[28px] ${b.count ? "bg-tvRed" : ""} rounded-t-[4px]" style="height:${h.toFixed(1)}px"></span>
            </div>`;
    }).join("");

    const axis = buckets.map((b, i) =>
        `<span class="flex-1 min-w-0 text-center text-[10.5px] text-gray-500 truncate">${i % showEvery === 0 || i === last ? escapeHtml(b.label) : ""}</span>`
    ).join("");

    const tableRows = buckets.slice().reverse().map(b => `
        <tr class="border-t border-gray-100">
            <td class="py-1.5 pr-4 text-gray-700">${escapeHtml(b.label)}</td>
            <td class="py-1.5 pr-4 text-right tabular-nums">${b.count}</td>
            <td class="py-1.5 text-right tabular-nums">${b.avg === null ? "—" : b.avg.toFixed(1) + "★"}</td>
        </tr>`).join("");

    return `
        <div class="flex items-end gap-1 border-b border-gray-200" style="height:${plotH}px">${bars}</div>
        <div class="flex gap-1 mt-1.5">${axis}</div>
        <details class="mt-3 text-[12.5px]">
            <summary class="cursor-pointer text-gray-500 hover:text-gray-900 font-semibold select-none">View as table</summary>
            <table class="w-full mt-2">
                <thead><tr class="text-left text-[11px] uppercase tracking-[0.04em] text-gray-500">
                    <th class="py-1 pr-4 font-semibold">${unit === "day" ? "Day" : unit === "week" ? "Week of" : "Month"}</th>
                    <th class="py-1 pr-4 font-semibold text-right">Reviews</th>
                    <th class="py-1 font-semibold text-right">Avg overall</th></tr></thead>
                <tbody>${tableRows}</tbody>
            </table>
        </details>`;
}

// ---------- tabs ----------
function renderOverviewTab() {
    const subs = reviewsInScope();
    if (!subs.length) return card("No reviews yet", `Nothing in the ${periodLabel()} for this branch filter.`, emptyNote("Try a longer period or another branch."));

    const overall = subs.map(s => validStar(s.ratings && s.ratings.overall)).filter(v => v !== null);
    const avgOverall = average(overall);
    const dist = [5, 4, 3, 2, 1].map(n => ({ n, count: overall.filter(v => v === n).length }));
    const distMax = Math.max(1, ...dist.map(d => d.count));

    const hero = `
        <div class="flex items-end gap-3 mb-4">
            <div class="text-[44px] font-bold text-gray-900 leading-none">${fmtAvg(avgOverall)}</div>
            <div class="pb-1">
                <div class="text-[15px] tracking-[1px] text-tvRed leading-none" aria-hidden="true">${starsText(Math.round(avgOverall || 0))}</div>
                <div class="text-[12px] text-gray-500 mt-1">out of 5 · ${overall.length} rating${overall.length === 1 ? "" : "s"}</div>
            </div>
        </div>
        ${dist.map(d => hBar({
            label: `${d.n} star${d.n === 1 ? "" : "s"}`,
            value: d.count, max: distMax,
            valueText: `${pct(d.count, overall.length)}%`, sub: `(${d.count})`,
            tip: `${d.n}★: ${d.count} review${d.count === 1 ? "" : "s"} (${pct(d.count, overall.length)}%)`
        })).join("")}`;

    // Category averages: current categories first, then old ids still present in the data
    const ids = categoriesInView().map(c => c.id);
    subs.forEach(s => Object.keys(s.ratings || {}).forEach(k => { if (k !== "staffService" && !ids.includes(k)) ids.push(k); }));
    const catRows = ids.map(id => {
        const vals = subs.map(s => validStar(s.ratings && s.ratings[id])).filter(v => v !== null);
        if (!vals.length) return null;
        const m = categoryMeta(id);
        const a = average(vals);
        return hBar({
            label: m.removed ? `${m.label} (removed)` : m.label, icon: m.icon, value: a, max: 5,
            valueText: `${a.toFixed(1)} ★`, sub: `(${vals.length})`, muted: m.removed,
            tip: `${m.label}: average ${a.toFixed(2)} from ${vals.length} rating${vals.length === 1 ? "" : "s"}`
        });
    }).filter(Boolean).join("");

    const trend = timeBuckets(subs);
    const trendTitle = trend.unit === "day" ? "Reviews per day" : trend.unit === "week" ? "Reviews per week" : "Reviews per month";

    return `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-[18px]">
            ${card("Overall rating", `${subs.length} review${subs.length === 1 ? "" : "s"} · ${periodLabel()}`, hero)}
            ${card("Ratings by category", "Average stars for each item customers rated", catRows || emptyNote("No category ratings yet."))}
            ${card(trendTitle, "Hover a bar for the average rating that " + trend.unit, vBarsChart(trend), "lg:col-span-2")}
        </div>`;
}

function renderBranchesTab() {
    const subs = reviewsInScope({ ignoreBranch: true });
    const list = (typeof branches !== "undefined" ? branches : []).map(b => {
        const bs = subs.filter(s => s.branchId === b.id);
        const vals = bs.map(s => validStar(s.ratings && s.ratings.overall)).filter(v => v !== null);
        return { b, subs: bs, count: bs.length, avg: average(vals) };
    }).filter(x => x.count || x.b.status !== "inactive")
      .sort((x, y) => (y.avg ?? -1) - (x.avg ?? -1) || y.count - x.count);

    if (!list.length) return card("Branches", "", emptyNote("No branches yet."));

    const rows = list.map(x => {
        const key = "branch:" + x.b.id;
        const open = expandedRows.has(key);
        const detail = open ? `
            <div class="pl-4 sm:pl-[10.75rem] pb-3">
                ${categoriesInView().map(c => {
                    const vals = x.subs.map(s => validStar(s.ratings && s.ratings[c.id])).filter(v => v !== null);
                    const a = average(vals);
                    return a === null ? "" : hBar({ label: c.label, icon: c.icon, value: a, max: 5, valueText: `${a.toFixed(1)} ★`, sub: `(${vals.length})` });
                }).join("") || '<p class="text-[12px] text-gray-500 py-1">No ratings in this period.</p>'}
            </div>` : "";
        return `
            <div class="border-b border-gray-100 last:border-b-0">
                <button type="button" data-expand="${escapeHtml(key)}" class="w-full text-left" aria-expanded="${open}">
                    ${x.avg === null
                        ? `<div class="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-3 py-1.5">
                               <span class="text-[13px] text-gray-700 truncate">${escapeHtml(x.b.name)}</span>
                               <span class="text-[12px] text-gray-400">No ratings in this period</span><span></span></div>`
                        : hBar({ label: x.b.name, value: x.avg, max: 5, valueText: `${x.avg.toFixed(1)} ★`, sub: `(${x.count})`,
                                 tip: `${x.b.name}: ${x.avg.toFixed(2)} average from ${x.count} review${x.count === 1 ? "" : "s"} — click for categories` })}
                </button>
                ${detail}
            </div>`;
    }).join("");

    return card("Overall rating per branch", `Best first · ${periodLabel()} · click a branch for its category ratings`, rows);
}

function collectWrittenAnswers(subs) {
    const items = [];
    subs.forEach(s => {
        const base = {
            name: s.customerName || "Anonymous",
            branch: s.branchName || branchName(s.branchId),
            time: submissionTime(s),
            stars: validStar(s.ratings && s.ratings.overall)
        };
        if (s.comment && s.comment.trim()) items.push({ ...base, source: "comment", sourceLabel: "Review", text: s.comment.trim() });
        const atmo = s.atmosphereOpen && s.atmosphereOpen.comment;
        if (atmo && atmo.trim()) items.push({ ...base, source: "atmosphere", sourceLabel: "Atmosphere", text: atmo.trim() });
        Object.entries(s.answers || {}).forEach(([qid, ans]) => {
            const q = questionMeta(qid);
            if (typeof ans !== "string" || !ans.trim() || qid === "atmosphere_open") return;
            if (q && q.type === "multiple_choice") return; // choices are charted in "Your questions"
            if (!q && (typeof surveyQuestions === "undefined" || !surveyQuestions.length)) return;
            items.push({ ...base, source: "question", sourceLabel: q ? q.question : "Deleted question", text: ans.trim() });
        });
    });
    return items.sort((a, b) => b.time - a.time);
}

function renderSuggestionsTab() {
    const all = collectWrittenAnswers(reviewsInScope());
    const q = (typeof currentSearch === "string" ? currentSearch : "").toLowerCase().trim();
    const counts = { all: all.length, comment: 0, atmosphere: 0, question: 0 };
    all.forEach(i => counts[i.source]++);
    let items = suggestionSource === "all" ? all : all.filter(i => i.source === suggestionSource);
    if (q) items = items.filter(i => (i.text + " " + i.name + " " + i.branch + " " + i.sourceLabel).toLowerCase().includes(q));

    const chip = (id, label) => `
        <button type="button" data-source="${id}" class="px-3 py-1.5 rounded-full text-[12px] font-semibold border transition-colors
            ${suggestionSource === id ? "bg-tvRed text-white border-tvRed" : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"}">
            ${label} <span class="${suggestionSource === id ? "text-white/80" : "text-gray-400"}">${counts[id]}</span>
        </button>`;

    const list = items.slice(0, suggestionLimit).map(i => `
        <article class="py-3.5 border-b border-gray-100 last:border-b-0">
            <p class="text-[13.5px] text-gray-800 leading-relaxed break-words">"${escapeHtml(i.text)}"</p>
            <p class="text-[11.5px] text-gray-500 mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5">
                <span class="font-semibold text-gray-700">${escapeHtml(i.name)}</span>
                <span>· ${escapeHtml(i.branch)}</span>
                <span>· ${escapeHtml(fmtDate(i.time))}</span>
                ${i.stars ? `<span class="text-tvRed" aria-label="${i.stars} stars">· ${"★".repeat(i.stars)}</span>` : ""}
                <span class="px-1.5 rounded bg-gray-100 text-gray-600 max-w-full truncate">${escapeHtml(i.sourceLabel)}</span>
            </p>
        </article>`).join("");

    const more = items.length > suggestionLimit
        ? `<button type="button" data-more-suggestions class="mt-3 w-full py-2 text-[12.5px] font-semibold text-gray-600 border border-gray-200 rounded-[6px] hover:bg-gray-50">Show more (${items.length - suggestionLimit} left)</button>` : "";

    return `
        <div class="flex flex-wrap gap-2 mb-4">
            ${chip("all", "All")}${chip("comment", "Review comments")}${chip("atmosphere", "Atmosphere")}${chip("question", "Your open questions")}
        </div>
        ${card("What customers wrote", `${items.length} answer${items.length === 1 ? "" : "s"} · newest first · ${periodLabel()}`,
            list || emptyNote(q ? "Nothing matches your search." : "No written answers yet.")) }
        ${more}`;
}

function renderStaffTab() {
    const subs = reviewsInScope();
    const byName = new Map();
    subs.forEach(s => {
        const name = (s.staffMember || "").trim();
        if (!name) return;
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push(s);
    });
    if (!byName.size) return card("Staff ratings", "", emptyNote(`No staff were picked in the ${periodLabel()}.`));

    const emps = typeof employees !== "undefined" ? employees : [];
    const rows = [...byName.entries()].map(([name, list]) => {
        const vals = list.map(s => validStar(s.ratings && s.ratings.staffService)).filter(v => v !== null);
        const emp = emps.find(e => e.name === name && (selectedBranchId === "All" || e.branchId === selectedBranchId)) || emps.find(e => e.name === name);
        const branchIds = list.map(s => s.branchId);
        const topBranch = branchIds.sort((a, b) => branchIds.filter(x => x === b).length - branchIds.filter(x => x === a).length)[0];
        return { name, list, avg: average(vals), ratings: vals.length, emp, branch: emp ? branchName(emp.branchId) : branchName(topBranch) };
    }).sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || b.list.length - a.list.length);

    const body = rows.map(r => {
        const key = "staff:" + r.name;
        const open = expandedRows.has(key);
        const comments = open ? r.list.filter(s => s.comment && s.comment.trim())
            .sort((a, b) => submissionTime(b) - submissionTime(a)).slice(0, 3) : [];
        return `
            <div class="border-b border-gray-100 last:border-b-0">
                <button type="button" data-expand="${escapeHtml(key)}" aria-expanded="${open}"
                        class="w-full text-left grid grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,13rem)_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-2.5"
                        data-tip="${escapeHtml(`${r.name}: ${r.avg === null ? "no staff ratings" : r.avg.toFixed(2) + " average"} · ${r.ratings} rating${r.ratings === 1 ? "" : "s"} · ${r.list.length} review${r.list.length === 1 ? "" : "s"} — click for comments`)}">
                    ${employeeAvatarHtml(r.emp || { name: r.name }, "w-9 h-9", "text-[13px]")}
                    <span class="min-w-0">
                        <span class="block text-[13.5px] font-semibold text-gray-900 truncate">${escapeHtml(r.name)}</span>
                        <span class="block text-[11.5px] text-gray-500 truncate">${escapeHtml(r.branch)} · ${r.list.length} review${r.list.length === 1 ? "" : "s"}</span>
                    </span>
                    <span class="col-span-2 sm:col-span-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                        <span class="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                            <span class="block h-full bg-tvRed rounded-r-[4px]" style="width:${r.avg ? (r.avg / 5 * 100).toFixed(1) : 0}%"></span>
                        </span>
                        <span class="text-[12.5px] font-semibold text-gray-900 whitespace-nowrap">${r.avg === null ? "—" : r.avg.toFixed(1) + " ★"} <span class="font-normal text-gray-500">(${r.ratings})</span></span>
                    </span>
                </button>
                ${open ? `<div class="pb-3 pl-12 space-y-2">${comments.length ? comments.map(s => `
                    <p class="text-[12.5px] text-gray-700 break-words">"${escapeHtml(s.comment.trim())}"
                        <span class="text-gray-400">— ${escapeHtml(s.customerName || "Anonymous")}, ${escapeHtml(fmtDate(submissionTime(s)))}</span></p>`).join("")
                    : '<p class="text-[12px] text-gray-500">No written comments for this staff member yet.</p>'}</div>` : ""}
            </div>`;
    }).join("");

    return card("Staff ratings", `Average service rating per staff member · best first · ${periodLabel()} · click for latest comments`, body);
}

// One question's results. subs = submissions of the same survey type as the question.
function questionCard(q, subs) {
        const answers = subs.map(s => ({ s, a: s.answers && s.answers[q.id] }))
            .filter(x => typeof x.a === "string" && x.a.trim());
        const sub = `${answers.length} answer${answers.length === 1 ? "" : "s"}${q.visible === false ? " · hidden from the survey" : ""}`;
        if (q.type === "multiple_choice") {
            const choices = (q.choices || []).slice();
            const counts = new Map(choices.map(c => [c, 0]));
            let other = 0;
            answers.forEach(({ a }) => (counts.has(a) ? counts.set(a, counts.get(a) + 1) : other++));
            const max = Math.max(1, ...counts.values(), other);
            const body = answers.length
                ? choices.map(c => hBar({ label: c, value: counts.get(c), max, valueText: `${pct(counts.get(c), answers.length)}%`, sub: `(${counts.get(c)})`,
                    tip: `${c}: ${counts.get(c)} of ${answers.length} (${pct(counts.get(c), answers.length)}%)` })).join("")
                  + (other ? hBar({ label: "Older answer options", value: other, max, valueText: `${pct(other, answers.length)}%`, sub: `(${other})`, muted: true,
                      tip: "Answers to choices you've since renamed or removed" }) : "")
                : emptyNote("No answers yet.");
            return card(q.question, `Multiple choice · ${sub}`, body);
        }
        const latest = answers.sort((x, y) => submissionTime(y.s) - submissionTime(x.s)).slice(0, 20);
        const body = latest.length
            ? `<div class="max-h-72 overflow-y-auto pr-1">${latest.map(({ s, a }) => `
                <p class="text-[13px] text-gray-800 py-2 border-b border-gray-100 last:border-b-0 break-words">"${escapeHtml(a.trim())}"
                    <span class="block text-[11px] text-gray-500 mt-0.5">${escapeHtml(s.customerName || "Anonymous")} · ${escapeHtml(s.branchName || branchName(s.branchId))} · ${escapeHtml(fmtDate(submissionTime(s)))}</span></p>`).join("")}</div>
               ${answers.length > 20 ? `<p class="text-[11.5px] text-gray-500 mt-2">Showing the latest 20. All of them are in the Suggestions tab.</p>` : ""}`
            : emptyNote("No answers yet.");
        return card(q.question, `Open-ended · ${sub}`, body);
}

// Questions follow the Type filter: Dine-in or Delivery shows only that survey's questions;
// "All" shows both surveys as two groups. Each question only counts answers from its own survey.
function renderQuestionsTab() {
    const subs = reviewsInScope();
    const qs = typeof surveyQuestions !== "undefined" ? surveyQuestions : [];
    const groups = [
        { type: "dinein", title: "🍲 Dine-in survey", name: "dine-in" },
        { type: "delivery", title: "🛵 Delivery survey", name: "delivery" }
    ].filter(g => selectedSurveyFilter === "All" || selectedSurveyFilter === g.type)
     .map(g => ({ ...g, questions: qs.filter(q => surveyTypeOf(q) === g.type) }));

    const shown = groups.filter(g => g.questions.length);
    if (!shown.length) {
        const msg = selectedSurveyFilter === "delivery" ? "No delivery questions yet. Add them on the Survey Questions page (Delivery survey)."
            : selectedSurveyFilter === "dinein" ? "No dine-in questions yet. Add them on the Survey Questions page (Dine-in survey)."
            : "You haven't added questions of your own yet (Survey Questions page).";
        return card("Your questions", "", emptyNote(msg));
    }

    const grid = cards => `<div class="grid grid-cols-1 lg:grid-cols-2 gap-[18px] items-start">${cards.join("")}</div>`;
    const sections = shown.map(g => {
        const typeSubs = subs.filter(s => surveyTypeOf(s) === g.type);
        const cards = g.questions.map(q => questionCard(q, typeSubs));
        // Headings only when both surveys are on screen
        return selectedSurveyFilter === "All"
            ? `<div><h2 class="text-[13px] font-bold text-gray-700 uppercase tracking-[0.04em] mb-3">${escapeHtml(g.title)}</h2>${grid(cards)}</div>`
            : grid(cards);
    });

    // Answers to questions that were deleted since
    const known = new Set(qs.map(q => q.id));
    const oldCount = subs.reduce((n, s) => n + Object.entries(s.answers || {})
        .filter(([id, a]) => !known.has(id) && id !== "atmosphere_open" && typeof a === "string" && a.trim()).length, 0);
    const older = oldCount ? `
        <details class="bg-white border border-gray-200 rounded-[10px] px-6 py-4">
            <summary class="cursor-pointer text-[13px] font-semibold text-gray-600 select-none">Older questions (${oldCount} answer${oldCount === 1 ? "" : "s"} to questions you've deleted)</summary>
            <p class="text-[12px] text-gray-500 mt-2">They're kept in each review. Open-ended ones also appear in the Suggestions tab.</p>
        </details>` : "";

    return `<div class="space-y-[26px]">${sections.join("")}</div>${older ? `<div class="mt-[18px]">${older}</div>` : ""}`;
}

// Full response block for one review in the All reviews tab
function fullResponseHtml(s) {
    const row = (label, value) => `
        <div class="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)] gap-3 py-1.5 border-b border-gray-100 last:border-b-0">
            <span class="text-[12px] text-gray-500 break-words">${label}</span>
            <span class="text-[12.5px] text-gray-900 break-words">${value}</span>
        </div>`;
    const stars = n => (validStar(n) ? `<span class="text-tvRed tracking-[1px]">${"★".repeat(n)}</span><span class="text-gray-300 tracking-[1px]">${"★".repeat(5 - n)}</span> <span class="text-gray-500">${n}/5</span>` : '<span class="text-gray-400">—</span>');

    const parts = [];
    const ids = ratingConfigFor(surveyTypeOf(s)).categories.map(c => c.id);
    Object.keys(s.ratings || {}).forEach(k => { if (k !== "staffService" && !ids.includes(k)) ids.push(k); });
    ids.forEach(id => {
        if (!s.ratings || s.ratings[id] === undefined) return;
        const m = categoryMeta(id, surveyTypeOf(s));
        parts.push(row(`${escapeHtml(m.icon)} ${escapeHtml(m.label)}${m.removed ? " (removed)" : ""}`, stars(s.ratings[id])));
    });
    if (s.atmosphereOpen && (s.atmosphereOpen.rating || (s.atmosphereOpen.comment || "").trim())) {
        parts.push(row("What they liked about the atmosphere",
            `${s.atmosphereOpen.rating ? stars(s.atmosphereOpen.rating) + "<br>" : ""}${escapeHtml((s.atmosphereOpen.comment || "").trim() || "—")}`));
    }
    parts.push(row("Staff member", s.staffMember ? escapeHtml(s.staffMember) : '<span class="text-gray-400">Not picked</span>'));
    if (s.ratings && s.ratings.staffService) parts.push(row("Staff rating", stars(s.ratings.staffService)));
    Object.entries(s.answers || {}).forEach(([qid, a]) => {
        if (qid === "atmosphere_open" || typeof a !== "string" || !a.trim()) return;
        const q = questionMeta(qid);
        parts.push(row(q ? escapeHtml(q.question) : '<span class="italic">Deleted question</span>', escapeHtml(a.trim())));
    });
    if (s.managerVisit) parts.push(row("Did the manager visit? (old question)", escapeHtml(s.managerVisit)));
    return `<div class="mt-2 bg-gray-50 border border-gray-100 rounded-[8px] px-4 py-2">${parts.join("")}</div>`;
}

// ---------- tab switching ----------
function renderReviewsTab() {
    if (typeof currentView === "undefined" || currentView !== "reviews") return;
    document.querySelectorAll("#reviewsTabs [data-rtab]").forEach(b => {
        const on = b.dataset.rtab === activeReviewTab;
        b.setAttribute("aria-selected", on);
        b.classList.toggle("text-gray-900", on);
        b.classList.toggle("border-tvRed", on);
        b.classList.toggle("text-gray-500", !on);
        b.classList.toggle("border-transparent", !on);
    });
    REVIEW_TABS.forEach(t => document.getElementById("rtab-" + t.id).classList.toggle("hidden", t.id !== activeReviewTab));
    document.getElementById("searchWrap").classList.toggle("hidden", !SEARCHABLE_TABS.includes(activeReviewTab));

    const panel = document.getElementById("rtab-" + activeReviewTab);
    if (activeReviewTab === "overview") panel.innerHTML = renderOverviewTab();
    if (activeReviewTab === "branches") panel.innerHTML = renderBranchesTab();
    if (activeReviewTab === "suggestions") panel.innerHTML = renderSuggestionsTab();
    if (activeReviewTab === "staff") panel.innerHTML = renderStaffTab();
    if (activeReviewTab === "questions") panel.innerHTML = renderQuestionsTab();
    if (activeReviewTab === "all") renderReviewsFeed();
}

// One floating tooltip for every [data-tip] (hover and keyboard focus); values are always printed too
function setupChartTooltip() {
    const tip = document.createElement("div");
    tip.className = "fixed z-[80] pointer-events-none hidden max-w-[260px] bg-tvDark text-white text-[11.5px] font-medium px-2.5 py-1.5 rounded-[6px] shadow-lg";
    document.body.appendChild(tip);
    const show = el => {
        tip.textContent = el.dataset.tip;
        tip.classList.remove("hidden");
        const r = el.getBoundingClientRect();
        const t = tip.getBoundingClientRect();
        let left = Math.min(window.innerWidth - t.width - 8, Math.max(8, r.left + r.width / 2 - t.width / 2));
        let top = r.top - t.height - 8;
        if (top < 8) top = r.bottom + 8;
        tip.style.left = left + "px";
        tip.style.top = top + "px";
    };
    const hide = () => tip.classList.add("hidden");
    const root = document.getElementById("reviewsView");
    root.addEventListener("mouseover", e => { const el = e.target.closest("[data-tip]"); el ? show(el) : hide(); });
    root.addEventListener("mouseleave", hide);
    root.addEventListener("focusin", e => { const el = e.target.closest("[data-tip]"); if (el) show(el); });
    root.addEventListener("focusout", hide);
    window.addEventListener("scroll", hide, { passive: true });
}

document.addEventListener("DOMContentLoaded", () => {
    const view = document.getElementById("reviewsView");
    if (!view) return;
    setupChartTooltip();

    document.getElementById("reviewsTabs").addEventListener("click", e => {
        const b = e.target.closest("[data-rtab]");
        if (!b) return;
        activeReviewTab = b.dataset.rtab;
        try { localStorage.setItem(REVIEW_TAB_KEY, activeReviewTab); } catch {}
        renderReviewsTab();
    });

    view.addEventListener("click", e => {
        const ex = e.target.closest("[data-expand]");
        if (ex) {
            const k = ex.dataset.expand;
            expandedRows.has(k) ? expandedRows.delete(k) : expandedRows.add(k);
            return renderReviewsTab();
        }
        const src = e.target.closest("[data-source]");
        if (src) { suggestionSource = src.dataset.source; suggestionLimit = 50; return renderReviewsTab(); }
        if (e.target.closest("[data-more-suggestions]")) { suggestionLimit += 50; return renderReviewsTab(); }
    });

    const period = document.getElementById("periodSelect");
    period.value = String(selectedPeriodDays);
    period.addEventListener("change", () => {
        selectedPeriodDays = Number(period.value);
        renderReviewsTab();
        renderReviewsFeed();
    });
});
