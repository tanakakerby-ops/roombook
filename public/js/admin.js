import { supabase } from "./supabase-config.js";

const { data: { user } } = await supabase.auth.getUser();
if (!user) window.location.href = "index.html";

document.getElementById("logout-btn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.href = "index.html";
});

const { data: profile } = await supabase.from("users").select("role, full_name").eq("id", user.id).single();

if (profile?.role === "student") {
  window.location.href = "dashboard.html";
}

document.getElementById("page-title").textContent =
  profile.role === "admin" ? "Admin dashboard" : "Facilitator dashboard";

if (profile.role === "admin") {
  await loadAdminOverview();
} else {
  await loadFacilitatorView();
}

await loadAppeals();

// ============================================================
// ADMIN VIEW
// ============================================================
async function loadAdminOverview() {
  const { data: rooms, error } = await supabase.rpc("get_all_rooms_summary");
  if (error || !rooms) return;

  document.getElementById("overview-panel").hidden = false;
  document.getElementById("rooms-panel").hidden = false;

  const totals = rooms.reduce(
    (acc, r) => ({
      bookings: acc.bookings + Number(r.total_bookings),
      no_shows: acc.no_shows + Number(r.no_shows),
      violations: acc.violations + Number(r.active_violations),
      appeals: acc.appeals + Number(r.pending_appeals)
    }),
    { bookings: 0, no_shows: 0, violations: 0, appeals: 0 }
  );

  document.getElementById("overview-stats").innerHTML = `
    ${statCard("Total bookings", totals.bookings)}
    ${statCard("No-shows", totals.no_shows, true)}
    ${statCard("Active violations", totals.violations, true)}
    ${statCard("Pending appeals", totals.appeals)}
  `;

  document.getElementById("rooms-list").innerHTML = rooms
    .map(
      (r) => `
    <div class="list-item">
      <div class="list-item-info">
        <p class="list-item-title">${r.room_name} <span class="badge badge-upcoming">${r.facilitator_name}</span></p>
        <p class="list-item-sub">${r.total_bookings} bookings &middot; ${r.no_shows} no-shows &middot; ${r.active_violations} active violations &middot; ${r.pending_appeals} pending appeals</p>
      </div>
      <button class="ghost-btn view-students-btn" data-id="${r.room_id}" data-name="${r.room_name}">View students</button>
    </div>`
    )
    .join("");

  document.querySelectorAll(".view-students-btn").forEach((btn) => {
    btn.addEventListener("click", () => loadStudentBreakdown(btn.dataset.id, btn.dataset.name));
  });
}

// ============================================================
// FACILITATOR VIEW
// ============================================================
async function loadFacilitatorView() {
  const { data: room } = await supabase
    .from("rooms")
    .select("id, room_name")
    .eq("facilitator_id", user.id)
    .maybeSingle();

  if (!room) {
    document.getElementById("my-room-panel").hidden = false;
    document.getElementById("my-room-title").textContent = "No room assigned yet";
    return;
  }

  document.getElementById("my-room-panel").hidden = false;
  document.getElementById("my-room-title").textContent = room.room_name;

  const { data: summaryRows } = await supabase.rpc("get_room_summary", { p_room_id: room.id });
  const s = summaryRows?.[0];
  if (s) {
    document.getElementById("my-room-stats").innerHTML = `
      ${statCard("Total bookings", s.total_bookings)}
      ${statCard("No-shows", s.no_shows, true)}
      ${statCard("Active violations", s.active_violations, true)}
      ${statCard("Pending appeals", s.pending_appeals)}
    `;
  }

  loadStudentBreakdown(room.id, room.room_name);
}

// ============================================================
// SHARED
// ============================================================
async function loadStudentBreakdown(roomId, roomName) {
  const { data: students, error } = await supabase.rpc("get_room_student_breakdown", { p_room_id: roomId });
  const panel = document.getElementById("students-panel");
  panel.hidden = false;
  document.getElementById("students-title").textContent = `Students - ${roomName}`;

  const tbody = document.getElementById("students-tbody");
  if (error || !students?.length) {
    tbody.innerHTML = `<tr><td colspan="5">No bookings yet for this room.</td></tr>`;
    return;
  }
  tbody.innerHTML = students
    .map(
      (s) => `
    <tr>
      <td>${s.full_name || "(no name)"}</td>
      <td>${s.email}</td>
      <td>${s.total_bookings}</td>
      <td>${s.no_shows}</td>
      <td>${s.active_violations}</td>
    </tr>`
    )
    .join("");
}

async function loadAppeals() {
  const { data: appeals, error } = await supabase
    .from("appeals")
    .select("id, reason, proof_file_url, submitted_at, violations(appointments(appt_date, rooms(id, room_name))), users(full_name, email)")
    .eq("appeal_status", "pending")
    .order("submitted_at", { ascending: true });

  const list = document.getElementById("appeals-list");
  const empty = document.getElementById("no-appeals");

  let scoped = appeals || [];
  if (profile.role === "facilitator") {
    const { data: myRoom } = await supabase.from("rooms").select("id").eq("facilitator_id", user.id).maybeSingle();
    scoped = scoped.filter((a) => a.violations?.appointments?.rooms?.id === myRoom?.id);
  }

  if (error || !scoped.length) {
    list.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.innerHTML = scoped
    .map(
      (a) => `
    <div class="list-item" data-id="${a.id}">
      <div class="list-item-info">
        <p class="list-item-title">${a.users?.full_name || a.users?.email}</p>
        <p class="list-item-sub">${a.violations?.appointments?.rooms?.room_name ?? ""} &middot; ${a.violations?.appointments?.appt_date ?? ""}</p>
        <p class="list-item-sub">${a.reason}</p>
        ${a.proof_file_url ? `<button class="ghost-btn view-proof-btn" data-path="${a.proof_file_url}" style="margin-top:6px;">View proof</button>` : ""}
      </div>
      <div style="display:flex; gap:8px;">
        <button class="ghost-btn approve-btn" data-id="${a.id}">Approve</button>
        <button class="ghost-btn deny-btn" data-id="${a.id}">Deny</button>
      </div>
    </div>`
    )
    .join("");

  list.querySelectorAll(".approve-btn").forEach((btn) =>
    btn.addEventListener("click", () => reviewAppeal(btn.dataset.id, "approved"))
  );
  list.querySelectorAll(".deny-btn").forEach((btn) =>
    btn.addEventListener("click", () => reviewAppeal(btn.dataset.id, "denied"))
  );
  list.querySelectorAll(".view-proof-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const { data, error } = await supabase.storage
        .from("appeal-proofs")
        .createSignedUrl(btn.dataset.path, 300);
      if (error || !data?.signedUrl) {
        alert("Couldn't load the proof file.");
        return;
      }
      window.open(data.signedUrl, "_blank");
    })
  );
}

async function reviewAppeal(appealId, decision) {
  const { error } = await supabase.rpc("review_appeal", { p_appeal_id: appealId, p_decision: decision });
  if (error) {
    alert("Couldn't review appeal: " + error.message);
    return;
  }
  loadAppeals();
}

function statCard(label, value, danger = false) {
  return `
    <div class="stat-card">
      <p class="stat-label">${label}</p>
      <p class="stat-value ${danger ? "stat-danger" : ""}">${value}</p>
    </div>`;
}
