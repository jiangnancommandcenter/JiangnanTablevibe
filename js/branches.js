// Branches (restaurant locations) — stored in the Firestore "branches" collection.
// Shared by the dashboard and the survey page. Each page defines window.onBranchesChanged()
// to refresh its own UI whenever the list changes.
//
// Doc id = short slug (e.g. "banawe"). Survey submissions and employees store this id in
// their branchId field, so ids must never change once created. Branches are deactivated,
// never deleted, because old reviews still point at them.

let branches = [];
let branchesLoaded = false;

// The original 8 hardcoded branches — used once by "Import existing branches" on the dashboard.
const DEFAULT_BRANCHES = [
    { id: "banawe",   name: "Banawe Flagship",  region: "Metro Manila North", address: "238 Banawe St., Quezon City",      manager: "Chef Howard Lim" },
    { id: "bf-homes", name: "BF Homes",         region: "Metro Manila South", address: "Aguirre Ave., Parañaque",          manager: "Elena Navarro" },
    { id: "ortigas",  name: "Ortigas Center",   region: "Metro Manila North", address: "Emerald Ave., Pasig City",         manager: "David Soriano" },
    { id: "tagaytay", name: "Tagaytay Ridge",   region: "South Luzon",        address: "Aguinaldo Highway, Tagaytay City", manager: "Sophia Sy" },
    { id: "nuvali",   name: "Nuvali Solenad",   region: "South Luzon",        address: "Solenad 3, Santa Rosa, Laguna",    manager: "Andre Villanueva" },
    { id: "fairview", name: "SM City Fairview", region: "Metro Manila North", address: "Parkway, Quezon City",             manager: "Rafael Diaz" },
    { id: "marikina", name: "SM City Marikina", region: "Metro Manila North", address: "Marcos Highway, Marikina",         manager: "Danica Bautista" },
    { id: "bgc",      name: "BGC High Street",  region: "Metro Manila South", address: "High Street Central, Taguig",      manager: "Hannah Morales" }
];

function activeBranches() {
    return branches.filter(b => b.status !== "inactive");
}

function branchName(id) {
    const b = branches.find(x => x.id === id);
    return b ? b.name : (id || "Unknown branch");
}

// "SM City Fairview" -> "sm-city-fairview"; adds -2, -3 … if the id is already taken
function uniqueBranchId(name) {
    const base = String(name)
        .toLowerCase()
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "branch";
    let id = base;
    for (let n = 2; branches.some(b => b.id === id); n++) id = `${base}-${n}`;
    return id;
}

function subscribeToBranches() {
    if (window.unsubscribeFromBranches) window.unsubscribeFromBranches();
    window.unsubscribeFromBranches = db.collection("branches").onSnapshot(snapshot => {
        branches = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .sort((a, b) => String(a.name).localeCompare(String(b.name)));
        branchesLoaded = true;
        if (typeof window.onBranchesChanged === "function") window.onBranchesChanged();
    }, error => {
        console.error("Error listening to branches:", error);
        branchesLoaded = true;
        if (typeof window.onBranchesChanged === "function") window.onBranchesChanged(error);
    });
}

document.addEventListener("DOMContentLoaded", subscribeToBranches);
