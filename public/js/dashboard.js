import { supabase } from "./supabase-config.js";

let currentUser = null;
let selectedSlot = null; // { start, end }
let realtimeChannel = null;

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
    document.getElementById("booking-form").querySelector("button[type=submit]").disabled = true;
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
  select.innerHTML =
    `<option value="">Select a room</option>` +
    rooms.map((r) => `<option value="${r.id}">${r.room_name} (capacity ${r.capacity})</option>`).join("");
}

// ---- Load and render the slot picker whenever room or date changes ----
const roomSelect = document.getElementById("room-select");
const dateInput = document.getElementById("booking-date");
const slotGrid = document.getElementById("slot-grid");
const slotHint = document.getElementById("slot-hint");

roomSelect.addEventListener("change", loadSlots);
dateInput.addEventListener("change", loadSlots);

async function loadSlots() {
  selectedSlot = null;
  const roomId = roomSelect.value;
  const date = dateInput.value;

  subscribeToRoomChanges(roomId);

  if (!roomId || !date) {
    slotGrid.innerHTML = "";
    slotHint.hidden = false;
    slotHint.textContent = "Pick a room and date to see available slots.";
    return;
  }

  slotHint.hidden = false;
  slotHint.textContent = "Loading slots...";

  const { data: slots, error } = await supabase.rpc("get_slot_availability", {
    p_room_id: roomId,
    p_date: date
  });

  if (error || !slots?.length) {
    slotGrid.innerHTML = "";
    slotHint.textContent = "Couldn't load slots for this room.";
    return;
  }

  slotHint.hidden = true;
  const now = new Date();
  const isToday = date === now.toISOString().slice(0, 10);

  slotGrid.innerHTML = slots
    .map((s) => {
      const isPast = isToday && s.slot_start <= now.toTimeString().slice(0, 5);
      const full = s.booked_count >= s.capacity;
      const limited = !full && s.booked_count > 0;
      const state = isPast ? "past" : full ? "full" : limited ? "limited" : "available";
      const disabled = isPast || full;
      return `
      <button type="button"
        class="slot-btn slot-${state}"
        data-start="${s.slot_start}"
        data-end="${s.slot_end}"
        ${disabled ? "disabled" : ""}>
        <span class="slot-time">${formatTime(s.slot_start)} - ${formatTime(s.slot_end)}</span>
        <span class="slot-count">${s.booked_count}/${s.capacity}</span>
      </button>`;
    })
    .join("");

  slotGrid.querySelectorAll(".slot-btn:not([disabled])").forEach((btn) => {
    btn.addEventListener("click", () => {
      slotGrid.querySelectorAll(".slot-btn").forEach((b) => b.classList.remove("slot-selected"));
      btn.classList.add("slot-selected");
      selectedSlot = { start: btn.dataset.start, end: btn.dataset.end };
    });
  });
}

function formatTime(t) {
  const [h, m] = t.split(":");
  const hour = ((+h + 11) % 12) + 1;
  return `${hour}:${m} ${+h < 12 ? "AM" : "PM"}`;
}

// Live-refresh the slot grid if someone else books/cancels this room while viewing
function subscribeToRoomChanges(roomId) {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  if (!roomId) return;

  realtimeChannel = supabase
    .channel(`room-${roomId}-appointments`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "appointments", filter: `room_id=eq.${roomId}` },
      () => loadSlots()
    )
    .subscribe();
}

// ---- Booking form submit ----
const bookingForm = document.getElementById("booking-form");
const bookingMsg = document.getElementById("booking-msg");

bookingForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  bookingMsg.hidden = true;

  const roomId = roomSelect.value;
  const date = dateInput.value;
  const purpose = document.getElementById("purpose").value.trim();

  if (!roomId) {
    showMsg("Please select a room.", true);
    return;
  }
  if (!selectedSlot) {
    showMsg("Please pick an available time slot.", true);
    return;
  }

  const { error } = await supabase.rpc("book_appointment", {
    p_room_id: roomId,
    p_date: date,
    p_start: selectedSlot.start,
    p_end: selectedSlot.end,
    p_purpose: purpose
  });

  if (error) {
    if (error.message.includes("SLOT_FULL")) {
      showMsg("That slot just filled up. Please pick a different time.", true);
      loadSlots();
    } else {
      showMsg("Something went wrong: " + error.message, true);
    }
    return;
  }

  showMsg("Booking confirmed!", false);
  bookingForm.reset();
  selectedSlot = null;
  slotGrid.innerHTML = "";
  slotHint.hidden = false;
  slotHint.textContent = "Pick a room and date to see available slots.";
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
