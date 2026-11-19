// Reviews page → "Export CSV" button (views.reviews in dashboard.html).
// Downloads the reviews currently in view as a CSV file that opens in Excel / Google Sheets.
//   - "All reviews" tab: exactly the feed (branch, type, period + staff/stars/sentiment/resolved/search)
//   - any other tab:     branch + type + period (those tabs don't show the extra filters)
// Uses the live data the dashboard already loads; nothing is read from Firestore here.

// Raw survey docs to export, newest first
function reviewsForExport() {
    if (activeReviewTab === "all") return filteredFeedReviews(feedReviewItems()).map(r => r.raw);
    return reviewsInScope().slice().sort((a, b) => submissionTime(b) - submissionTime(a));
}

// One CSV cell. Survey text is public input, so anything Excel would run as a formula
// (= + - @, tab, carriage return at the start) is prefixed with ' to keep it plain text.
function csvCell(value) {
    let text = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

const pad2 = n => String(n).padStart(2, "0");
const csvDate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const csvTime = d => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const toDateOrNull = ts => (ts && typeof ts.toDate === "function" ? ts.toDate()
    : ts && typeof ts.seconds === "number" ? new Date(ts.seconds * 1000) : null);
const yesNo = v => (v ? "Yes" : "No");
const answerText = a => (typeof a === "string" ? a.trim() : a === null || a === undefined ? "" : JSON.stringify(a));

// Header + rows for these survey docs
function buildReviewsCsv(subs) {
    // Rating columns: the categories in the current Type view first, then any other ids in the data
    const ratingIds = categoriesInView().map(c => c.id).filter(id => id !== "overall");
    subs.forEach(s => Object.keys(s.ratings || {}).forEach(k => {
        if (k !== "overall" && k !== "staffService" && !ratingIds.includes(k)) ratingIds.push(k);
    }));
    const usedRatingIds = ratingIds.filter(id => subs.some(s => s.ratings && s.ratings[id] !== undefined));

    // Custom question columns: current questions that have at least one answer, in survey order
    const allQuestions = typeof surveyQuestions !== "undefined" ? surveyQuestions : [];
    const hasAnswer = (s, qid) => answerText((s.answers || {})[qid]) !== "";
    const questions = allQuestions.filter(q => subs.some(s => hasAnswer(s, q.id)));
    const knownIds = new Set(allQuestions.map(q => q.id));
    const otherAnswers = s => Object.entries(s.answers || {})
        .filter(([qid, a]) => qid !== "atmosphere_open" && !knownIds.has(qid) && answerText(a) !== "")
        .map(([, a]) => answerText(a)).join(" | ");
    const anyOther = subs.some(s => otherAnswers(s) !== "");
    const anyManagerVisit = subs.some(s => s.managerVisit);

    const header = [
        "Date", "Time", "Branch", "Type", "Customer", "Overall (1-5)",
        ...usedRatingIds.map(id => `${categoryMeta(id).label}${categoryMeta(id).removed ? " (removed)" : ""} (1-5)`),
        "Staff member", "Staff rating (1-5)", "Comment", "Dish",
        "Atmosphere rating (1-5)", "Atmosphere comment",
        ...questions.map(q => q.question),
        ...(anyOther ? ["Other answers (deleted questions)"] : []),
        ...(anyManagerVisit ? ["Did the manager visit? (old question)"] : []),
        "Resolved", "Resolution note", "Resolved at", "Flagged", "Review ID"
    ];

    const rows = subs.map(s => {
        const at = new Date(submissionTime(s));
        // A reopened review keeps its old resolvedAt in the database: only export it while resolved
        const resolvedAt = s.resolved === true ? toDateOrNull(s.resolvedAt) : null;
        const atmo = s.atmosphereOpen || {};
        const atmoComment = (atmo.comment || "").trim() || answerText((s.answers || {}).atmosphere_open);
        return [
            csvDate(at), csvTime(at),
            s.branchName || branchName(s.branchId),
            surveyTypeOf(s) === "delivery" ? "Delivery" : "Dine-in",
            s.customerName || "Anonymous",
            validStar(s.ratings && s.ratings.overall) ?? "",
            ...usedRatingIds.map(id => validStar(s.ratings && s.ratings[id]) ?? ""),
            s.staffMember || "",
            validStar(s.ratings && s.ratings.staffService) ?? "",
            (s.comment || "").trim(),
            (s.dish || "").trim(),
            validStar(atmo.rating) ?? "",
            atmoComment,
            ...questions.map(q => answerText((s.answers || {})[q.id])),
            ...(anyOther ? [otherAnswers(s)] : []),
            ...(anyManagerVisit ? [s.managerVisit || ""] : []),
            yesNo(s.resolved === true),
            (s.resolutionNote || "").trim(),
            resolvedAt ? `${csvDate(resolvedAt)} ${csvTime(resolvedAt)}` : "",
            yesNo(!!s.flagged),
            s.id || ""
        ];
    });

    return [header, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n");
}

function exportFileName() {
    const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "all";
    const branch = selectedBranchId === "All" ? "all-branches" : slug(branchName(selectedBranchId));
    const type = selectedSurveyFilter === "All" ? "" : "_" + selectedSurveyFilter;
    const period = selectedPeriodDays ? `last-${selectedPeriodDays}-days` : "all-time";
    return `jiangnan-reviews_${branch}${type}_${period}_${csvDate(new Date())}.csv`;
}

function exportReviews() {
    const subs = reviewsForExport();
    if (!subs.length) {
        showToast("Nothing to export: no reviews match the current filters.");
        return;
    }
    // BOM first so Excel reads the file as UTF-8 (★, ₱, Chinese and Filipino names)
    const blob = new Blob(["﻿" + buildReviewsCsv(subs)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Exported ${subs.length} review${subs.length === 1 ? "" : "s"}.`);
}
