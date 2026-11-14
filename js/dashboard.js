// Survey submissions (customer reviews) — readable only by signed-in staff
let surveySubmissions = [];
let selectedStaffFilter = "All";

// Submissions in the current branch scope
function scopedSubmissions() {
    return selectedBranchId === "All"
        ? surveySubmissions
        : surveySubmissions.filter(s => s.branchId === selectedBranchId);
}

function overallRating(s) {
    const r = s.ratings && Number(s.ratings.overall);
    return r >= 1 && r <= 5 ? r : null;
}

// Per-branch stats computed from live submissions
function branchStats(branchId) {
    const subs = surveySubmissions.filter(s => s.branchId === branchId);
    const rated = subs.map(overallRating).filter(r => r !== null);
    const latest = subs
        .slice()
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
        .find(s => s.comment);
    return {
        count: subs.length,
        avg: rated.length ? rated.reduce((a, b) => a + b, 0) / rated.length : null,
        latest
    };
}

// Update KPI metrics using live survey submissions from Firestore
function updateKPIs() {
    const filtered = scopedSubmissions();
    const ratings = filtered.map(overallRating).filter(r => r !== null);

    const avg = ratings.length
        ? (ratings.reduce((sum, r) => sum + r, 0) / ratings.length).toFixed(2)
        : "—";
    const positive = ratings.filter(r => r >= 4).length;
    const sentiment = ratings.length
        ? ((positive / ratings.length) * 100).toFixed(1) + "%"
        : "—";
    const activeBranches = new Set(filtered.map(s => s.branchId).filter(Boolean)).size;

    document.getElementById("kpiTotalReviews").textContent = filtered.length.toLocaleString();
    document.getElementById("kpiAvgRating").textContent = avg;
    document.getElementById("kpiSentiment").textContent = sentiment;
    document.getElementById("kpiActiveBranches").textContent = activeBranches;
}

// Real-time listener for survey submissions (started after sign-in)
function subscribeToSurveySubmissions() {
    if (window.unsubscribeFromSurveys) {
        window.unsubscribeFromSurveys();
    }
    window.unsubscribeFromSurveys = db.collection("surveys")
        .onSnapshot(snapshot => {
            surveySubmissions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            updateKPIs();
            renderDashboardBranches();
            renderReviewsFeed();
            if (typeof renderBranchesAdmin === "function") renderBranchesAdmin();
            if (typeof renderReviewsTab === "function") renderReviewsTab();
        }, error => {
            console.error("Error listening to survey submissions:", error);
            showToast("Could not load reviews. Check that you are signed in.");
        });
}

function unsubscribeFromSurveySubmissions() {
    if (window.unsubscribeFromSurveys) {
        window.unsubscribeFromSurveys();
        window.unsubscribeFromSurveys = null;
    }
    surveySubmissions = [];
}

// Staff filter handler
function setStaffFilter(staffName) {
    selectedStaffFilter = staffName;
    renderReviewsFeed();
}
