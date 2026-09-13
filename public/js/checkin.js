import { supabase } from "./supabase-config.js";

const { data: { user } } = await supabase.auth.getUser();
if (!user) window.location.href = "index.html";

const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single();
if (profile?.role === "student") {
  window.location.href = "dashboard.html";
}

document.getElementById("logout-btn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.href = "index.html";
});

const readerDiv = document.getElementById("reader");
const resultPanel = document.getElementById("result-panel");
const resultSuccess = document.getElementById("result-success");
const resultError = document.getElementById("result-error");

let scanner = null;
let isProcessing = false;

function startScanner() {
  readerDiv.hidden = false;
  resultPanel.hidden = true;
  scanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: 220 }, false);
  scanner.render(onScanSuccess, () => {});
}

async function onScanSuccess(decodedText) {
  if (isProcessing) return;
  isProcessing = true;
  await scanner.pause(true);
  await runCheckIn(decodedText);
}

async function runCheckIn(token) {
  const { data, error } = await supabase.rpc("check_in_with_qr", { p_token: token });

  readerDiv.hidden = true;
  resultPanel.hidden = false;

  if (error) {
    resultSuccess.hidden = true;
    resultError.hidden = false;
    document.getElementById("error-text").textContent = friendlyError(error.message);
    return;
  }

  const row = data?.[0];
  resultError.hidden = true;
  resultSuccess.hidden = false;
  document.getElementById("result-room").textContent = "Checked in successfully";
  document.getElementById("result-purpose").textContent = "Purpose: " + (row?.purpose ?? "-");
  document.getElementById("result-time").textContent = "Time: " + new Date(row?.check_in_time).toLocaleTimeString();
}

function friendlyError(msg) {
  if (msg.includes("INVALID_QR")) return "This QR code doesn't match any booking.";
  if (msg.includes("ALREADY_USED")) return "This QR code has already been used to check in.";
  if (msg.includes("OUTSIDE_WINDOW")) return "This is outside the check-in time window for that booking.";
  return "Couldn't check in: " + msg;
}

document.getElementById("scan-next-btn").addEventListener("click", async () => {
  isProcessing = false;
  if (scanner) {
    await scanner.clear();
  }
  startScanner();
});

document.getElementById("manual-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const token = document.getElementById("manual-token").value.trim();
  if (!token) return;
  readerDiv.hidden = true;
  if (scanner) await scanner.clear();
  await runCheckIn(token);
  document.getElementById("manual-token").value = "";
});

startScanner();
