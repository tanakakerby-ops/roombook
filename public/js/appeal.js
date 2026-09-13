import { supabase } from "./supabase-config.js";

const { data: { user } } = await supabase.auth.getUser();
if (!user) window.location.href = "index.html";

const select = document.getElementById("violation-select");
const noViolations = document.getElementById("no-violations");
const form = document.getElementById("appeal-form");
const msg = document.getElementById("appeal-msg");

async function loadAppealableViolations() {
  // Active violations that don't already have a pending or approved appeal
  const { data: violations, error } = await supabase
    .from("violations")
    .select("id, issued_at, appointments(appt_date, rooms(room_name)), appeals(appeal_status)")
    .eq("user_id", user.id)
    .eq("status", "active");

  if (error || !violations?.length) {
    select.hidden = true;
    form.querySelector("button").disabled = true;
    noViolations.hidden = false;
    return;
  }

  const appealable = violations.filter(
    (v) => !v.appeals?.some((a) => a.appeal_status === "pending" || a.appeal_status === "approved")
  );

  if (!appealable.length) {
    select.hidden = true;
    form.querySelector("button").disabled = true;
    noViolations.hidden = false;
    return;
  }

  select.innerHTML = appealable
    .map(
      (v) =>
        `<option value="${v.id}">${v.appointments?.rooms?.room_name ?? "Room"} - ${v.appointments?.appt_date ?? ""}</option>`
    )
    .join("");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.hidden = true;

  const violationId = select.value;
  const reason = document.getElementById("reason").value.trim();
  const fileInput = document.getElementById("proof-file");
  const file = fileInput.files[0];

  if (!violationId || !reason) {
    showMsg("Please fill in all required fields.", true);
    return;
  }

  const submitBtn = document.getElementById("submit-appeal-btn");
  submitBtn.disabled = true;

  let proofPath = null;

  if (file) {
    if (file.size > 5 * 1024 * 1024) {
      showMsg("File is too large - max 5MB.", true);
      submitBtn.disabled = false;
      return;
    }
    const path = `${user.id}/${Date.now()}_${file.name}`;
    const { error: uploadError } = await supabase.storage.from("appeal-proofs").upload(path, file);
    if (uploadError) {
      showMsg("Couldn't upload the file: " + uploadError.message, true);
      submitBtn.disabled = false;
      return;
    }
    proofPath = path;
  }

  const { error: insertError } = await supabase.from("appeals").insert({
    violation_id: violationId,
    user_id: user.id,
    reason,
    proof_file_url: proofPath,
    appeal_status: "pending"
  });

  if (insertError) {
    showMsg("Couldn't submit the appeal: " + insertError.message, true);
    submitBtn.disabled = false;
    return;
  }

  showMsg("Appeal submitted! Staff will review it soon.", false);
  form.reset();
  loadAppealableViolations();
  submitBtn.disabled = false;
});

function showMsg(text, isError) {
  msg.textContent = text;
  msg.className = "msg " + (isError ? "msg-error" : "msg-success");
  msg.hidden = false;
}

loadAppealableViolations();
