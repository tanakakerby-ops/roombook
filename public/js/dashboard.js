import { supabase } from "./supabase-config.js";

let currentUser = null;

// ---- Guard: must be logged in ----
const { data: { user } } = await supabase.auth.getUser();
if (!user) {
  window.location.href = "index.html";
}
currentUser = user;

document.getElementById("logout-btn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.href = "index.html";
});

// ---- Check account status ----
async function checkAccountStatus() {
  const { data: profile } = await supabase
    .from("users")
    .select("account_status")
    .eq("id", currentUser.id)
    .single();

  if (profile?.account_status === "suspended") {
    document.getElementById("suspended-banner").hidden = false;
    document.getElementById("booking-form").querySelector("button").disabled = true;
  }
}

// ---- Load rooms into the select dropdown ----
async function loadRooms() {
  const { data: rooms, error } = await supabase
    .from("rooms")
    .select("id, room_name, room_type, capacity")
    .eq("is_active", true)
    .order("room_name");

  const select = document.getElementById("room-select");
  if (error || !rooms?.length) {
    select.innerHTML = `<option value="">No rooms available</option>`;
    return;
  }
  select.innerHTML = rooms
    .map((r) => `<option value="${r.id}">${r.room_name} (capacity ${r.capacity})</option>`)
    .join("");
}

// ---- Booking form submit ----
const bookingForm = document.getElementById("booking-form");
const bookingMsg = document.getElementById("booking-msg");

bookingForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  bookingMsg.hidden = true;

  const roomId = document.getElementById("room-select").value;
  const date = document.getElementById("booking-date").value;
  const startTime = document.getElementById("start-time").value;
  const endTime = document.getElementById("end-time").value;
  const purpose = document.getElementById("purpose").value.trim();

  if (!roomId) {
    showMsg("Please select a room.", true);
    return;
  }
  if (endTime <= startTime) {
    showMsg("End time must be after start time.", true);
    return;
  }

  const { error } = await supabase.rpc("book_appointment", {
    p_room_id: roomId,
    p_date: date,
    p_start: startTime,
    p_end: endTime,
    p_purpose: purpose
  });

  if (error) {
    if (error.message.includes("SLOT_FULL")) {
      showMsg("That slot is already full. Please pick a different time.", true);
    } else {
      showMsg("Something went wrong: " + error.message, true);
    }
    return;
  }

  showMsg("Booking confirmed!", false);
  bookingForm.reset();
  loadAppointments();
});

function showMsg(text, isError) {
  bookingMsg.textContent = text;
  bookingMsg.className = "msg " + (isError ? "msg-error" : "msg-success");
  bookingMsg.hidden = false;
}

// ---- Load and render upcoming appointments ----
async function loadAppointments() {
  const { data: appts, error } = await supabase
    .from("appointments")
    .select("id, appt_date, start_time, end_time, purpose, status, qr_token, rooms(room_name)")
    .eq("user_id", currentUser.id)
    .in("status", ["upcoming", "attended"])
    .order("appt_date", { ascending: true })
    .order("start_time", { ascending: true });

  const list = document.getElementById("appointments-list");
  const emptyState = document.getElementById("no-appointments");

  if (error || !appts?.length) {
    list.innerHTML = "";
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  list.innerHTML = appts
    .map(
      (a) => `
    <div class="list-item" data-id="${a.id}">
      <div class="list-item-info">
        <p class="list-item-title">${a.rooms?.room_name ?? "Room"} &middot; ${a.appt_date}</p>
        <p class="list-item-sub">${a.start_time} - ${a.end_time} &middot; ${a.purpose}</p>
        <p class="badge badge-${a.status}">${a.status.replace("_", " ")}</p>
      </div>
      <div class="qr-box" id="qr-${a.id}"></div>
      ${a.status === "upcoming" ? `<button class="ghost-btn cancel-btn" data-id="${a.id}">Cancel</button>` : ""}
    </div>`
    )
    .join("");

  // Render QR codes after the HTML is in the DOM
  appts.forEach((a) => {
    if (a.status === "upcoming") {
      new QRCode(document.getElementById(`qr-${a.id}`), {
        text: a.qr_token,
        width: 96,
        height: 96
      });
    }
  });

  document.querySelectorAll(".cancel-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Cancel this appointment?")) return;
      const { error } = await supabase.rpc("cancel_appointment", { p_appointment_id: btn.dataset.id });
      if (error) {
        alert("Couldn't cancel: " + error.message);
        return;
      }
      loadAppointments();
    });
  });
}

checkAccountStatus();
loadRooms();
loadAppointments();
