// Employees array for real-time updates (shared by the dashboard and the survey page)
let employees = [];
let employeeSearch = "";            // dashboard Employees page: "Search employee" box
let employeeUnassignedOnly = false; // dashboard Employees page: "Unassigned" chip

// No branch, or a branch that no longer exists (deleted). Until branches have loaded,
// only an empty branchId counts, so nobody flashes up as unassigned on page load.
function isUnassigned(emp) {
    if (!emp.branchId) return true;
    const loaded = typeof branchesLoaded !== "undefined" && branchesLoaded;
    return loaded && !branches.some(b => b.id === emp.branchId);
}

// The search box and chip only exist on the dashboard (the survey page loads this file too)
document.addEventListener("DOMContentLoaded", () => {
    const input = document.getElementById("employeeSearchInput");
    if (input) {
        input.addEventListener("input", () => {
            employeeSearch = input.value;
            renderEmployees();
        });
    }
    const chip = document.getElementById("unassignedFilterBtn");
    if (chip) {
        chip.addEventListener("click", () => {
            employeeUnassignedOnly = !employeeUnassignedOnly;
            // Unassigned staff have no branch: show the Branch select as "All" so the bar isn't contradictory
            if (employeeUnassignedOnly && typeof selectBranch === "function"
                && typeof selectedBranchId !== "undefined" && selectedBranchId !== "All") {
                selectBranch("All"); // re-renders the list too
            } else {
                renderEmployees();
            }
        });
    }
});

// Chip label "Unassigned (N)" and on/off style (same look as the review star-filter chips)
function updateUnassignedChip(count) {
    const chip = document.getElementById("unassignedFilterBtn");
    if (!chip) return;
    chip.textContent = `Unassigned (${count})`;
    chip.setAttribute("aria-pressed", String(employeeUnassignedOnly));
    chip.classList.toggle("bg-tvRed", employeeUnassignedOnly);
    chip.classList.toggle("border-tvRed", employeeUnassignedOnly);
    chip.classList.toggle("text-white", employeeUnassignedOnly);
    chip.classList.toggle("bg-white", !employeeUnassignedOnly);
    chip.classList.toggle("border-gray-300", !employeeUnassignedOnly);
    chip.classList.toggle("text-gray-600", !employeeUnassignedOnly);
    chip.classList.toggle("hover:bg-gray-100", !employeeUnassignedOnly);
}

// Real-time listener for employees (employees are publicly readable, so no login needed)
function subscribeToEmployees() {
    if (window.unsubscribeFromEmployees) {
        window.unsubscribeFromEmployees();
    }
    window.unsubscribeFromEmployees = db.collection("employees")
        .onSnapshot(snapshot => {
            employees = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderEmployees();
            // Dashboard: staff counts on the Branches page, staff photos on the Reviews > Staff tab
            if (typeof renderBranchesAdmin === "function") {
                renderBranchesAdmin();
            }
            if (typeof renderReviewsTab === "function") renderReviewsTab();
            // Survey page: refresh the staff picker once employees arrive
            if (typeof renderStaffList === "function") {
                renderStaffList();
            }
        }, error => {
            console.error("Error listening to employees:", error);
        });
}

// Round avatar: Cloudinary photo if there is one, otherwise the first letter of the name
function employeeAvatarHtml(emp, sizeClass = "w-10 h-10", textClass = "text-sm") {
    const name = (emp && emp.name) || "?";
    const thumb = emp && cloudinaryThumb(emp.photoUrl, 160);
    if (thumb) {
        return `<img src="${escapeHtml(thumb)}" alt="${escapeHtml(name)}" loading="lazy" class="${sizeClass} rounded-full object-cover bg-gray-100 shrink-0">`;
    }
    return `<div class="${sizeClass} rounded-full bg-tvDark text-white flex items-center justify-center font-bold ${textClass} shrink-0">${escapeHtml(name.charAt(0).toUpperCase())}</div>`;
}

// Render employees list (dashboard only)
function renderEmployees() {
    const listEl = document.getElementById("employeesList");
    const emptyEl = document.getElementById("emptyEmployeesState");
    if (!listEl) return;

    const unassigned = employees.filter(isUnassigned);
    updateUnassignedChip(unassigned.length);

    // "Unassigned" chip on: only staff without a branch (the Branch select is ignored, since
    // they have none). Otherwise the Branch filter from the bar at the top ("All" = every branch).
    const filterId = typeof selectedBranchId !== "undefined" ? selectedBranchId : "All";
    const filtering = !employeeUnassignedOnly && filterId && filterId !== "All";
    const inBranch = employeeUnassignedOnly ? unassigned
        : filtering ? employees.filter(emp => emp.branchId === filterId) : employees.slice();
    // "Search employee" box (dashboard toolbar): name, position or branch name
    const q = employeeSearch.trim().toLowerCase();
    const shown = (q ? inBranch.filter(emp =>
            [emp.name, emp.position, isUnassigned(emp) ? "Unassigned" : branchName(emp.branchId)]
                .some(v => String(v || "").toLowerCase().includes(q)))
        : inBranch)
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

    const summaryEl = document.getElementById("employeesSummary");
    if (summaryEl) {
        const matching = q ? ` · matching "${employeeSearch.trim()}"` : "";
        const where = filtering ? ` · ${branchName(filterId)}` : " across all branches";
        summaryEl.textContent = employeeUnassignedOnly
            ? `${shown.length} unassigned employee${shown.length === 1 ? "" : "s"}${matching}`
            : filtering || q
            ? `${shown.length} of ${employees.length} employee${employees.length === 1 ? "" : "s"}${where}${matching}`
            : `${employees.length} employee${employees.length === 1 ? "" : "s"} across all branches`;
    }

    if (shown.length === 0) {
        listEl.innerHTML = "";
        document.getElementById("emptyEmployeesTitle").textContent =
            q ? `No employee matches "${employeeSearch.trim()}"`
            : employeeUnassignedOnly ? "No unassigned employees"
            : filtering ? `No employees at ${branchName(filterId)}` : "No employees found";
        document.getElementById("emptyEmployeesText").textContent =
            q ? "Check the spelling, or clear the search box."
            : employeeUnassignedOnly ? "Everyone has a branch."
            : filtering ? "Pick another branch above, or add an employee to this branch." : "Add your first employee to get started.";
        emptyEl.classList.remove("hidden");
        return;
    }

    emptyEl.classList.add("hidden");

    listEl.innerHTML = shown.map(emp => {
        const name = emp.name || "Unnamed";
        const noBranch = isUnassigned(emp); // grey tag: needs a branch (click Edit)
        return `
            <article class="min-w-0 bg-white border border-gray-200 rounded-[10px] px-5 py-4 flex flex-col gap-3 hover:border-gray-300 transition-colors">
                <div class="flex items-center gap-4 min-w-0">
                    ${employeeAvatarHtml(emp, "w-11 h-11")}
                    <div class="min-w-0">
                        <h3 class="text-[14px] font-bold text-gray-900 truncate">${escapeHtml(name)}</h3>
                        <p class="text-[12px] text-gray-500 truncate">${escapeHtml(emp.position || "Staff Member")}</p>
                    </div>
                </div>
                <div class="flex items-center gap-2 pt-3 border-t border-gray-100 mt-auto">
                    <span class="min-w-0 truncate px-2.5 py-1 rounded-full bg-gray-100 text-[11px] font-semibold ${noBranch ? "text-gray-500 border border-dashed border-gray-300" : "text-tvRed"}">
                        ${escapeHtml(noBranch ? "Unassigned" : branchName(emp.branchId))}
                    </span>
                    <span class="flex-1"></span>
                    <button type="button" data-action="edit-employee" data-id="${escapeHtml(emp.id)}" class="px-3 py-1.5 rounded-[6px] border border-gray-200 text-gray-700 hover:bg-gray-100 text-[12px] font-semibold transition-colors">
                        Edit
                    </button>
                    <button type="button" data-action="delete-employee" data-id="${escapeHtml(emp.id)}" aria-label="Delete ${escapeHtml(name)}" class="text-gray-400 hover:text-tvRed transition-colors cursor-pointer p-1">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                </div>
            </article>
        `;
    }).join("");
}

// ---------- Add / edit modal ----------
// Photo state while the modal is open. The file is only uploaded when "Save" is clicked,
// so cancelling never leaves stray images in Cloudinary.
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
let pendingPhotoFile = null;   // new file chosen in the modal
let pendingPhotoPreview = "";  // object URL for the preview
let removeExistingPhoto = false;

function clearPendingPhoto() {
    if (pendingPhotoPreview) URL.revokeObjectURL(pendingPhotoPreview);
    pendingPhotoFile = null;
    pendingPhotoPreview = "";
}

function renderPhotoPreview() {
    const box = document.getElementById("empPhotoPreview");
    const removeBtn = document.getElementById("empPhotoRemoveBtn");
    if (!box) return;
    const editId = document.getElementById("empEditId").value;
    const existing = editId ? employees.find(e => e.id === editId) : null;
    const name = document.getElementById("empName").value.trim() || (existing && existing.name) || "?";

    let src = "";
    if (pendingPhotoPreview) src = pendingPhotoPreview;
    else if (existing && !removeExistingPhoto) src = cloudinaryThumb(existing.photoUrl, 200);

    box.innerHTML = src
        ? `<img src="${escapeHtml(src)}" alt="" class="w-full h-full object-cover">`
        : escapeHtml(name.charAt(0).toUpperCase());
    removeBtn.classList.toggle("hidden", !src);
}

// Open the modal: no id = add a new employee, id = edit that employee
function openEmployeeModal(editId = null) {
    const form = document.getElementById("addEmployeeForm");
    const branchSelect = document.getElementById("empBranchId");
    const backdrop = document.getElementById("employeeModalBackdrop");

    if (!form || !branchSelect || !backdrop) {
        console.error("Employee modal elements not found");
        return;
    }

    const emp = editId ? employees.find(e => e.id === editId) : null;

    form.reset();
    clearPendingPhoto();
    removeExistingPhoto = false;
    document.getElementById("empEditId").value = emp ? emp.id : "";
    document.getElementById("employeeModalHeading").textContent = emp ? "Edit Employee" : "Add New Employee";

    // Active branches, plus the employee's current branch even if it was deactivated
    const options = activeBranches().slice();
    if (emp && emp.branchId && !options.some(b => b.id === emp.branchId)) {
        options.push({ id: emp.branchId, name: branchName(emp.branchId) + " (inactive)" });
    }
    branchSelect.innerHTML = '<option value="">Select a branch</option>' +
        options.map(b => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}${b.region ? ` (${escapeHtml(b.region)})` : ""}</option>`).join("");

    if (emp) {
        document.getElementById("empName").value = emp.name || "";
        document.getElementById("empPosition").value = emp.position || "";
        branchSelect.value = emp.branchId || "";
    } else if (typeof selectedBranchId !== "undefined" && selectedBranchId !== "All") {
        branchSelect.value = selectedBranchId; // new employee: start with the filtered branch
    }
    renderPhotoPreview();

    backdrop.classList.remove("hidden");
    backdrop.classList.add("flex");
    setTimeout(() => document.getElementById("empName").focus(), 50);
}

// Close add employee modal
function closeEmployeeModal() {
    const backdrop = document.getElementById("employeeModalBackdrop");
    if (!backdrop) return;
    backdrop.classList.add("hidden");
    backdrop.classList.remove("flex");
    clearPendingPhoto();
}

// Upload one image to Cloudinary with the unsigned preset; returns { url, publicId }
async function uploadEmployeePhoto(file) {
    const form = new FormData();
    form.append("file", file);
    form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    form.append("folder", CLOUDINARY_EMPLOYEE_FOLDER);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
        method: "POST",
        body: form
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.secure_url) {
        const msg = (data.error && data.error.message) || `HTTP ${res.status}`;
        const err = new Error(msg);
        err.cloudinary = true;
        throw err;
    }
    return { url: data.secure_url, publicId: data.public_id };
}

// Handle add / edit employee form submission
async function handleAddEmployee(e) {
    e.preventDefault();

    const editId = document.getElementById("empEditId").value;
    const name = document.getElementById("empName").value.trim();
    const position = document.getElementById("empPosition").value.trim();
    const branchId = document.getElementById("empBranchId").value;
    const saveBtn = document.getElementById("empSaveBtn");

    if (!name || !position || !branchId) {
        showToast("Please fill in all fields.");
        return;
    }

    // Reviews store the staff member's NAME, and the Staff tab groups ratings by it. So two people
    // with the same name would share one rating history, and a rename starts a new one.
    const sameName = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
    if (employees.some(emp => emp.id !== editId && sameName(emp.name, name))) {
        showToast(`Another employee is already called "${name}". Add a last name or initial so their ratings stay separate.`);
        return;
    }
    const current = editId ? employees.find(emp => emp.id === editId) : null;
    if (current && !sameName(current.name, name)) {
        const oldName = String(current.name || "").trim();
        const reviewCount = (typeof surveySubmissions !== "undefined" ? surveySubmissions : [])
            .filter(s => sameName(s.staffMember, oldName)).length;
        if (reviewCount) {
            const reviews = `${reviewCount} review${reviewCount === 1 ? "" : "s"}`;
            const chip = (text, cls) => `<span class="inline-flex max-w-full truncate px-2.5 py-1 rounded-full text-[12.5px] font-semibold ${cls}">${escapeHtml(text)}</span>`;
            const ok = typeof confirmDialog === "function"
                ? await confirmDialog({
                    tone: "warning",
                    title: `Rename ${oldName}?`,
                    body: `
                        <div class="flex items-center gap-2 flex-wrap">
                            ${chip(oldName, "bg-gray-100 text-gray-700")}
                            <span class="text-gray-400" aria-hidden="true">→</span>
                            ${chip(name, "bg-red-50 text-tvRed")}
                        </div>
                        <p><strong class="text-gray-900">${escapeHtml(oldName)}</strong> has <strong class="text-gray-900">${reviews}</strong> under this name.
                           Those stay under "${escapeHtml(oldName)}", and new reviews start a separate rating history for "${escapeHtml(name)}".</p>`,
                    confirmLabel: "Rename anyway",
                    cancelLabel: "Keep old name"
                })
                : confirm(`${oldName} has ${reviews} under this name. Renaming starts a new rating history for "${name}". Continue?`);
            if (!ok) return; // nothing saved
        }
    }

    saveBtn.disabled = true;
    try {
        const data = { name, position, branchId };

        if (pendingPhotoFile) {
            saveBtn.textContent = "Uploading photo…";
            const photo = await uploadEmployeePhoto(pendingPhotoFile);
            data.photoUrl = photo.url;
            data.photoPublicId = photo.publicId;
        } else if (removeExistingPhoto && editId) {
            data.photoUrl = firebase.firestore.FieldValue.delete();
            data.photoPublicId = firebase.firestore.FieldValue.delete();
        }

        saveBtn.textContent = "Saving…";
        if (editId) {
            data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection("employees").doc(editId).update(data);
            showToast(`"${name}" updated.`);
        } else {
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection("employees").add(data);
            showToast(`Employee "${name}" added successfully!`);
        }
        closeEmployeeModal();
    } catch (error) {
        console.error("Error saving employee:", error);
        if (error.cloudinary) {
            showToast(/unsigned/i.test(error.message)
                ? 'Photo upload blocked: set the "tablevibe" upload preset to Unsigned in Cloudinary.'
                : `Photo upload failed: ${error.message}`);
        } else {
            showToast("Failed to save employee. Please try again.");
        }
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Employee";
    }
}

// Delete employee
async function deleteEmployee(employeeId) {
    const emp = employees.find(x => x.id === employeeId);
    const empName = (emp && emp.name) || "this employee";
    if (!(await confirmDialog({
        tone: "danger",
        title: `Delete ${empName}?`,
        body: `<p>Their profile and photo disappear from the dashboard and from the survey's staff list.</p>
               <p>Past reviews that mention <strong class="text-gray-900">${escapeHtml(empName)}</strong> are kept.</p>`,
        confirmLabel: "Delete employee",
        cancelLabel: "Keep"
    }))) return;

    try {
        await db.collection("employees").doc(employeeId).delete();
        showToast("Employee removed successfully.");
    } catch (error) {
        console.error("Error deleting employee:", error);
        showToast("Failed to delete employee.");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    // Delegated click handler for employee buttons (no inline onclick with interpolated ids)
    const listEl = document.getElementById("employeesList");
    if (listEl) {
        listEl.addEventListener("click", e => {
            const btn = e.target.closest("[data-action]");
            if (!btn) return;
            if (btn.dataset.action === "delete-employee") deleteEmployee(btn.dataset.id);
            if (btn.dataset.action === "edit-employee") openEmployeeModal(btn.dataset.id);
        });
    }

    // Photo picker in the modal (dashboard only)
    const photoInput = document.getElementById("empPhotoInput");
    if (photoInput) {
        photoInput.addEventListener("change", () => {
            const file = photoInput.files && photoInput.files[0];
            photoInput.value = ""; // allow picking the same file again
            if (!file) return;
            if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
                showToast("Please choose a JPG, PNG or WebP image.");
                return;
            }
            if (file.size > MAX_PHOTO_BYTES) {
                showToast("That photo is larger than 5 MB. Please choose a smaller one.");
                return;
            }
            clearPendingPhoto();
            pendingPhotoFile = file;
            pendingPhotoPreview = URL.createObjectURL(file);
            removeExistingPhoto = false;
            renderPhotoPreview();
        });
        document.getElementById("empPhotoRemoveBtn").addEventListener("click", () => {
            clearPendingPhoto();
            removeExistingPhoto = true;
            renderPhotoPreview();
        });
        document.getElementById("empName").addEventListener("input", () => {
            if (!pendingPhotoPreview) renderPhotoPreview(); // keep the letter avatar in sync
        });
    }

    subscribeToEmployees();
});
