import { supabase } from "./supabase-config.js";

// Must match the check in the handle_new_user() database trigger.
const SCHOOL_EMAIL_PATTERN = /^[0-9]{5,10}@g\.cu\.edu\.ph$/i;

const loginCard = document.querySelector(".auth-card");
const checkEmailCard = document.getElementById("check-email-card");
const checkEmailSubtitle = document.getElementById("check-email-subtitle");
const form = document.getElementById("login-form");
const errorMsg = document.getElementById("error-msg");
const loginBtn = document.getElementById("login-btn");
const toggleLink = document.getElementById("show-signup");

let mode = "login";

toggleLink.addEventListener("click", (e) => {
  e.preventDefault();
  mode = mode === "login" ? "signup" : "login";
  loginBtn.textContent = mode === "login" ? "Log In" : "Create account";
  toggleLink.textContent = mode === "login" ? "New here? Create an account" : "Already have an account? Log in";
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorMsg.hidden = true;
  loginBtn.disabled = true;

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  if (!SCHOOL_EMAIL_PATTERN.test(email)) {
    errorMsg.textContent = "Please use your school email, e.g. 2095928@g.cu.edu.ph";
    errorMsg.hidden = false;
    loginBtn.disabled = false;
    return;
  }

  try {
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await redirectByRole();
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      // Email confirmation is required (Supabase dashboard setting),
      // so show a "check your email" message instead of logging in immediately.
      checkEmailSubtitle.textContent =
        `We sent a confirmation link to ${email}. Click it to activate your account, then come back and log in here.`;
      loginCard.hidden = true;
      checkEmailCard.hidden = false;
    }
  } catch (err) {
    errorMsg.textContent = friendlyError(err);
    errorMsg.hidden = false;
    loginBtn.disabled = false;
  }
});

async function redirectByRole() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  window.location.href = profile?.role === "student" ? "dashboard.html" : "admin.html";
}

function friendlyError(err) {
  const msg = err.message || "";
  if (msg.includes("INVALID_SCHOOL_EMAIL")) return "Please use your school email, e.g. 2095928@g.cu.edu.ph";
  if (msg.includes("Invalid login credentials")) return "Incorrect email or password.";
  if (msg.includes("Email not confirmed")) return "Please confirm your email first - check your inbox for the link.";
  if (msg.includes("already registered")) return "An account with that email already exists.";
  return msg || "Something went wrong. Please try again.";
}

// If already logged in - including right after clicking the email
// confirmation link, which brings the session back in the URL - skip
// straight to the dashboard. The Supabase client parses that
// automatically on load, so this just needs to check for a session.
supabase.auth.getSession().then(({ data: { session } }) => {
  if (session) redirectByRole();
});
