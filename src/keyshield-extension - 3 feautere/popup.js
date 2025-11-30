// =============================
// GLOBAL VARIABLES
// =============================
let keystrokeTimings = [];
let lastKeyTime = 0;
let enrollmentTimes = [];
let enrollmentStep = 1;
let enrollmentStartTime = 0;
let currentAuthToken = '';

// API Configuration
const API_URL = "https://web-production-75759.up.railway.app"; // Added port for consistency

// =============================
// ELEMENTS
// =============================
const passwordLogin = document.getElementById("password-login");
const emailStep = document.getElementById("email-step");
const otpStep = document.getElementById("otp-step");
const enrollmentSection = document.getElementById("enrollment-section");
const statusMsg = document.getElementById("status");
const logoutBtn = document.getElementById("logout");

// =============================
// BUTTONS
// =============================
const loginBtn = document.getElementById("loginBtn");
const emailLoginBtn = document.getElementById("emailLoginBtn");
const sendOtpBtn = document.getElementById("sendOtpBtn");
const verifyOtpBtn = document.getElementById("verifyOtpBtn");
const backToPassword = document.getElementById("backToPassword");
const backToEmail = document.getElementById("backToEmail");
const enrollBtn = document.getElementById("enrollBtn");
const skipEnrollBtn = document.getElementById("skipEnrollBtn");

// =============================
// SIMPLE POPUP CLOSING FUNCTION
// =============================
function safeClosePopup(delay = 500) {
  setTimeout(() => {
    console.log("🔒 Closing extension popup...");
    
    // Simple and safe - only close the popup window
    // This works because we're in the popup context, not background
    if (window.location.protocol === 'chrome-extension:') {
      window.close();
    }
  }, delay);
}

// =============================
// SWITCH LOGIN METHODS (Password → Email OTP)
// =============================
emailLoginBtn.addEventListener("click", () => {
  passwordLogin.style.display = "none";
  emailStep.style.display = "block";
  otpStep.style.display = "none";
  enrollmentSection.style.display = "none";
  statusMsg.textContent = "";
});

backToPassword.addEventListener("click", () => {
  passwordLogin.style.display = "block";
  emailStep.style.display = "none";
  otpStep.style.display = "none";
  enrollmentSection.style.display = "none";
  statusMsg.textContent = "";
});

backToEmail.addEventListener("click", () => {
  emailStep.style.display = "block";
  otpStep.style.display = "none";
  enrollmentSection.style.display = "none";
  statusMsg.textContent = "";
});

// =============================
// ENHANCED KEYSTROKE DYNAMICS TRACKING
// =============================
function getActiveInput() {
    const activeEl = document.activeElement;
    if (activeEl && (
        (activeEl.tagName === 'INPUT' && (activeEl.type === 'password' || activeEl.id === 'username')) ||
        activeEl.id.startsWith('enroll-password')
    )) {
        return activeEl;
    }
    return null;
}

// Enhanced keystroke timing capture
document.addEventListener('keydown', (e) => {
    const activeInput = getActiveInput();
    if (!activeInput) return;

    if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Tab') {
        const currentTime = performance.now();
        if (lastKeyTime > 0) {
            const timeDiff = currentTime - lastKeyTime;
            
            keystrokeTimings.push({
                type: 'keydown',
                key: e.key,
                timestamp: currentTime,
                time_since_last: timeDiff,
                input_id: activeInput.id,
                input_type: activeInput.type,
                shift_key: e.shiftKey,
                ctrl_key: e.ctrlKey,
                alt_key: e.altKey
            });
        } else {
            // First key press
            keystrokeTimings.push({
                type: 'keydown',
                key: e.key,
                timestamp: currentTime,
                time_since_last: 0,
                input_id: activeInput.id,
                input_type: activeInput.type,
                shift_key: e.shiftKey,
                ctrl_key: e.ctrlKey,
                alt_key: e.altKey
            });
        }
        lastKeyTime = currentTime;
    }
}, true);

// Track keyup for dwell time (hold duration)
document.addEventListener('keyup', (e) => {
    const activeInput = getActiveInput();
    if (!activeInput) return;

    if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
        const currentTime = performance.now();
        const dwellTime = currentTime - lastKeyTime;

        keystrokeTimings.push({
            type: 'keyup',
            key: e.key,
            timestamp: currentTime,
            dwell_time: dwellTime,
            input_id: activeInput.id,
            input_type: activeInput.type
        });
    }
}, true);

// Reset timings when input fields are focused
document.getElementById("username").addEventListener("focus", () => {
    keystrokeTimings = [];
    lastKeyTime = 0;
});

document.getElementById("password").addEventListener("focus", () => {
    keystrokeTimings = [];
    lastKeyTime = 0;
});

// =============================
// ENHANCED TYPING METRICS CALCULATION (FIXED TIMING)
// =============================
function calculateTypingMetrics(keystrokes) {
    if (!keystrokes || keystrokes.length === 0) {
        return {
            average_speed: 0,
            total_keystrokes: 0,
            average_dwell_time: 0,
            backspace_ratio: 0,
            shift_usage: 0
        };
    }

    const keydownEvents = keystrokes.filter(k => k.type === 'keydown');
    const keyupEvents = keystrokes.filter(k => k.type === 'keyup');
    
    // Calculate inter-key timing (in milliseconds)
    const interKeyTimes = [];
    for (let i = 1; i < keydownEvents.length; i++) {
        if (keydownEvents[i].time_since_last > 0) {
            interKeyTimes.push(keydownEvents[i].time_since_last);
        }
    }
    
    // Calculate dwell times (in milliseconds)
    const dwellTimes = keyupEvents
        .filter(k => k.dwell_time > 0)
        .map(k => k.dwell_time);
    
    // Calculate metrics - ensure we're using milliseconds consistently
    const averageSpeed = interKeyTimes.length > 0 ? 
        interKeyTimes.reduce((a, b) => a + b, 0) / interKeyTimes.length : 0;
    
    const averageDwellTime = dwellTimes.length > 0 ?
        dwellTimes.reduce((a, b) => a + b, 0) / dwellTimes.length : 0;
    
    const backspaceCount = keydownEvents.filter(k => k.key === 'Backspace').length;
    const backspaceRatio = keydownEvents.length > 0 ? backspaceCount / keydownEvents.length : 0;
    
    const shiftUsage = keydownEvents.filter(k => k.shift_key).length;

    console.log("📊 Typing Metrics:", {
        average_speed_ms: averageSpeed,
        average_dwell_time_ms: averageDwellTime,
        total_keystrokes: keystrokes.length,
        inter_key_times: interKeyTimes
    });

    return {
        average_speed: averageSpeed, // in milliseconds
        total_keystrokes: keystrokes.length,
        average_dwell_time: averageDwellTime, // in milliseconds
        backspace_ratio: backspaceRatio,
        shift_usage: shiftUsage,
        inter_key_times: interKeyTimes,
        dwell_times: dwellTimes
    };
}

// =============================
// PASSWORD + KEYSTROKE DYNAMICS LOGIN - FIXED VERSION
// =============================
loginBtn.addEventListener("click", async () => {
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;

  if (!username || !password) {
    statusMsg.textContent = "Please enter both username and password.";
    return;
  }
  
  statusMsg.textContent = "Logging in with keystroke verification...";

  try {
    // Calculate typing metrics for keystroke dynamics
    const typingMetrics = calculateTypingMetrics(keystrokeTimings);
    const currentSpeed = typingMetrics.average_speed || 0;

    console.log("🔐 Keystroke Dynamics Authentication:", {
      username,
      keystroke_count: keystrokeTimings.length,
      current_speed_ms: currentSpeed,
      metrics: typingMetrics
    });

    const response = await fetch(`${API_URL}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        username, 
        password,
        current_speed: currentSpeed,
        keystrokeTimings: keystrokeTimings, // Fixed parameter name
        typing_metrics: typingMetrics
      })
    });

    // Check if response is JSON
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.error("❌ Server returned non-JSON response:", text.substring(0, 200));
      throw new Error(`Server error (Status: ${response.status}). Please check if backend is running.`);
    }

    const data = await response.json();
    console.log("✅ Login Response:", data);

    if (data.success && data.token) {
      currentAuthToken = data.token;
      
      // Store JWT and Login State
      await chrome.storage.local.set({ 
        loggedIn: true, 
        keyshield_jwt: data.token 
      });
      
      // Notify background script
      chrome.runtime.sendMessage({ type: "login-success" });
      
      // Check if keystroke enrollment is needed
      if (data.requires_enrollment) {
        statusMsg.textContent = "✅ Login successful! Enabling keystroke protection...";
        console.log("🎯 Keystroke Dynamics: Enrollment required");
        showKeystrokeEnrollment(data.token);
      } else {
        statusMsg.textContent = "✅ Login Successful! Keystroke protection verified.";
        console.log("🎯 Keystroke Dynamics: Authentication successful");
        safeClosePopup(1000);
      }

    } else {
      statusMsg.textContent = `❌ ${data.message || "Login failed"}`;
      // Reset for retry
      keystrokeTimings = [];
      lastKeyTime = 0;
    }
  } catch (error) {
    console.error("❌ Login error:", error);
    statusMsg.textContent = `❌ ${error.message || "Connection failed. Check if server is running on port 8000."}`;
  }
});

// =============================
// SEND OTP (Step 1) - FIXED VERSION
// =============================
sendOtpBtn.addEventListener("click", async () => {
  const email = document.getElementById("email").value;

  if (!email) {
    statusMsg.textContent = "Please enter your email.";
    return;
  }

  try {
    statusMsg.textContent = "Sending OTP...";
    
    const response = await fetch(`${API_URL}/api/send-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });

    // Check if response is JSON
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      throw new Error(`Server error (Status: ${response.status})`);
    }

    const data = await response.json();

    if (data.success) {
      statusMsg.textContent = "✅ OTP sent to email.";
      emailStep.style.display = "none";
      otpStep.style.display = "block";
    } else {
      statusMsg.textContent = `❌ ${data.message || "Failed to send OTP"}`;
    }
  } catch (error) {
    console.error("Send OTP error:", error);
    statusMsg.textContent = `❌ ${error.message || "Connection failed"}`;
  }
});

// =============================
// VERIFY OTP (Step 2) - FIXED VERSION
// =============================
verifyOtpBtn.addEventListener("click", async () => {
  const email = document.getElementById("email").value;
  const otp = document.getElementById("otp").value;

  if (!email || !otp) {
    statusMsg.textContent = "Please enter OTP.";
    return;
  }

  try {
    statusMsg.textContent = "Verifying OTP...";
    
    const response = await fetch(`${API_URL}/api/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, otp })
    });

    // Check if response is JSON
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      throw new Error(`Server error (Status: ${response.status})`);
    }

    const data = await response.json();

    if (data.success && data.token) {
      statusMsg.textContent = "✅ OTP Verified! Logged in.";
      currentAuthToken = data.token;
      
      // Store JWT and Login State
      await chrome.storage.local.set({ 
        loggedIn: true, 
        keyshield_jwt: data.token 
      });
      
      // Notify background script about successful login
      chrome.runtime.sendMessage({ type: "login-success" });
      
      // Check if keystroke enrollment is needed
      if (data.requires_enrollment) {
        console.log("🎯 Keystroke Dynamics: Enrollment required after OTP login");
        showKeystrokeEnrollment(data.token);
      } else {
        safeClosePopup(500);
      }
    } else {
      statusMsg.textContent = `❌ ${data.message || "Incorrect or expired OTP"}`;
    }
  } catch (error) {
    console.error("Verify OTP error:", error);
    statusMsg.textContent = `❌ ${error.message || "Connection failed"}`;
  }
});

// =============================
// KEYSTROKE-LEVEL TIMING FOR ENROLLMENT
// =============================

// Store keystroke data for each enrollment field
const enrollmentKeystrokeData = {
  'enroll-password1': [],
  'enroll-password2': [], 
  'enroll-password3': []
};

// Setup keystroke tracking for enrollment fields
function setupEnrollmentKeystrokeTracking() {
  const enrollmentFields = [
    'enroll-password1', 
    'enroll-password2', 
    'enroll-password3'
  ];
  
  enrollmentFields.forEach(fieldId => {
    const field = document.getElementById(fieldId);
    let fieldLastKeyTime = 0;
    
    // Clear previous data
    enrollmentKeystrokeData[fieldId] = [];
    
    field.addEventListener('keydown', (e) => {
      if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
        const currentTime = performance.now();
        if (fieldLastKeyTime > 0) {
          const timeDiff = currentTime - fieldLastKeyTime;
          enrollmentKeystrokeData[fieldId].push({
            type: 'keydown',
            key: e.key,
            timestamp: currentTime,
            time_since_last: timeDiff,
            input_id: fieldId,
            shift_key: e.shiftKey,
            ctrl_key: e.ctrlKey,
            alt_key: e.altKey
          });
        } else {
          // First key press
          enrollmentKeystrokeData[fieldId].push({
            type: 'keydown',
            key: e.key,
            timestamp: currentTime,
            time_since_last: 0,
            input_id: fieldId,
            shift_key: e.shiftKey,
            ctrl_key: e.ctrlKey,
            alt_key: e.altKey
          });
        }
        fieldLastKeyTime = currentTime;
      }
    });
    
    // Track keyup for dwell time
    field.addEventListener('keyup', (e) => {
      if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
        const currentTime = performance.now();
        const dwellTime = currentTime - fieldLastKeyTime;

        enrollmentKeystrokeData[fieldId].push({
          type: 'keyup',
          key: e.key,
          timestamp: currentTime,
          dwell_time: dwellTime,
          input_id: fieldId
        });
      }
    });
    
    // Reset timing when field is focused
    field.addEventListener('focus', () => {
      fieldLastKeyTime = 0;
    });
  });
}

// Calculate metrics from enrollment keystroke data
function calculateEnrollmentMetrics() {
  let allKeystrokes = [];
  let totalInterKeyTime = 0;
  let interKeyCount = 0;
  
  // Combine keystrokes from all enrollment fields
  Object.values(enrollmentKeystrokeData).forEach(keystrokes => {
    allKeystrokes = allKeystrokes.concat(keystrokes);
    
    // Calculate inter-key timing for this field
    const keydownEvents = keystrokes.filter(k => k.type === 'keydown');
    const interKeyTimes = [];
    
    for (let i = 1; i < keydownEvents.length; i++) {
      if (keydownEvents[i].time_since_last > 0) {
        interKeyTimes.push(keydownEvents[i].time_since_last);
      }
    }
    
    if (interKeyTimes.length > 0) {
      totalInterKeyTime += interKeyTimes.reduce((a, b) => a + b, 0);
      interKeyCount += interKeyTimes.length;
    }
  });
  
  const averageSpeed = interKeyCount > 0 ? totalInterKeyTime / interKeyCount : 0;
  
  console.log("🎯 Enrollment Keystroke Metrics:", {
    average_speed_ms: averageSpeed,
    total_keystrokes: allKeystrokes.length,
    inter_key_count: interKeyCount,
    fields_data: Object.keys(enrollmentKeystrokeData).map(fieldId => ({
      field: fieldId,
      keystrokes: enrollmentKeystrokeData[fieldId].length
    }))
  });
  
  return {
    average_speed: averageSpeed,
    all_keystrokes: allKeystrokes,
    timing_samples: Object.values(enrollmentKeystrokeData).filter(arr => arr.length > 0)
  };
}

// =============================
// ENHANCED ENROLLMENT FUNCTIONS
// =============================
function showKeystrokeEnrollment(token) {
  currentAuthToken = token;
  passwordLogin.style.display = "none";
  emailStep.style.display = "none";
  otpStep.style.display = "none";
  enrollmentSection.style.display = "block";
  
  // Reset enrollment state
  enrollmentStep = 1;
  enrollmentTimes = [];
  
  // Show first step
  document.getElementById("enrollment-step-1").style.display = "block";
  document.getElementById("enrollment-step-2").style.display = "none";
  document.getElementById("enrollment-step-3").style.display = "none";
  
  // Update progress indicator
  updateProgressIndicator(1);
  
  // Setup keystroke tracking for enrollment
  setupEnrollmentKeystrokeTracking();
  
  // Focus on first password field
  document.getElementById("enroll-password1").focus();
  
  console.log("🎯 Keystroke Dynamics: Starting enrollment process with keystroke-level timing");
}

function updateProgressIndicator(step) {
  // Update step indicators
  for (let i = 1; i <= 3; i++) {
    const stepElement = document.getElementById(`step-${i}`);
    const connector = stepElement.nextElementSibling;
    
    if (i < step) {
      stepElement.classList.add('completed');
      stepElement.classList.remove('active');
      if (connector && connector.classList.contains('progress-connector')) {
        connector.classList.add('active');
      }
    } else if (i === step) {
      stepElement.classList.add('active');
      stepElement.classList.remove('completed');
    } else {
      stepElement.classList.remove('active', 'completed');
      if (connector && connector.classList.contains('progress-connector')) {
        connector.classList.remove('active');
      }
    }
  }
}

function handleEnrollmentStep(password, step) {
  const endTime = performance.now();
  const timeTaken = endTime - enrollmentStartTime;
  enrollmentTimes.push({
    step: step,
    time_taken: timeTaken,
    password_length: password.length,
    timestamp: new Date().toISOString(),
    keystroke_count: enrollmentKeystrokeData[`enroll-password${step}`]?.length || 0
  });
  
  console.log(`🎯 Keystroke Dynamics: Step ${step} completed in ${timeTaken.toFixed(0)}ms with ${enrollmentKeystrokeData[`enroll-password${step}`]?.length || 0} keystrokes`);
  
  if (step < 3) {
    // Move to next step
    document.getElementById(`enrollment-step-${step}`).style.display = "none";
    document.getElementById(`enrollment-step-${step + 1}`).style.display = "block";
    document.getElementById(`enroll-password${step + 1}`).focus();
    enrollmentStep = step + 1;
    updateProgressIndicator(step + 1);
  } else {
    // All steps completed, enable the complete button
    document.getElementById("enrollBtn").disabled = false;
    statusMsg.textContent = "✅ All samples collected. Click 'Complete Enrollment' to finish.";
    console.log("🎯 Keystroke Dynamics: All 3 samples collected");
  }
}

async function completeEnrollment() {
  const password1 = document.getElementById("enroll-password1").value;
  const password2 = document.getElementById("enroll-password2").value;
  const password3 = document.getElementById("enroll-password3").value;
  
  // Validate that all passwords match
  if (password1 !== password2 || password1 !== password3) {
    statusMsg.textContent = "❌ Passwords do not match. Please try again.";
    showKeystrokeEnrollment(currentAuthToken);
    return;
  }
  
  // Calculate enrollment metrics from keystroke-level timing
  const enrollmentMetrics = calculateEnrollmentMetrics();
  const averageSpeed = enrollmentMetrics.average_speed;
  
  console.log("🎯 Keystroke Dynamics: Final enrollment metrics", {
    average_speed_ms: averageSpeed,
    total_keystrokes: enrollmentMetrics.all_keystrokes.length,
    timing_samples: enrollmentMetrics.timing_samples.length
  });
  
  try {
    statusMsg.textContent = "⏳ Enabling keystroke protection...";
    
    const response = await fetch(`${API_URL}/api/enroll-keystroke`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${currentAuthToken}`
      },
      body: JSON.stringify({
        password: password1,
        average_speed: averageSpeed,
        timing_samples: enrollmentMetrics.timing_samples,
        keystroke_data: enrollmentMetrics.all_keystrokes,
        enrollment_times: enrollmentTimes
      })
    });

    // Check if response is JSON
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      throw new Error(`Server error (Status: ${response.status})`);
    }
    
    const data = await response.json();
    if (data.success) {
      statusMsg.textContent = "✅ Keystroke protection enabled!";
      console.log("🎯 Keystroke Dynamics: Enrollment successful!");
      safeClosePopup(1000);
    } else {
      statusMsg.textContent = `❌ ${data.message || "Enrollment failed"}`;
    }
  } catch (error) {
    console.error("❌ Enrollment error:", error);
    statusMsg.textContent = `❌ ${error.message || "Connection failed"}`;
  }
}

// Track start time when focusing on enrollment fields
document.getElementById("enroll-password1").addEventListener("focus", () => {
  enrollmentStartTime = performance.now();
  console.log("🎯 Keystroke Dynamics: Starting step 1 timing");
});

document.getElementById("enroll-password2").addEventListener("focus", () => {
  enrollmentStartTime = performance.now();
  console.log("🎯 Keystroke Dynamics: Starting step 2 timing");
});

document.getElementById("enroll-password3").addEventListener("focus", () => {
  enrollmentStartTime = performance.now();
  console.log("🎯 Keystroke Dynamics: Starting step 3 timing");
});

// Handle completion of each enrollment step
document.getElementById("enroll-password1").addEventListener("blur", function() {
  if (this.value) handleEnrollmentStep(this.value, 1);
});

document.getElementById("enroll-password2").addEventListener("blur", function() {
  if (this.value) handleEnrollmentStep(this.value, 2);
});

document.getElementById("enroll-password3").addEventListener("blur", function() {
  if (this.value) handleEnrollmentStep(this.value, 3);
});

// Enrollment buttons
enrollBtn.addEventListener("click", completeEnrollment);

skipEnrollBtn.addEventListener("click", () => {
  statusMsg.textContent = "⚠️ Keystroke protection not enabled. You can enable it later.";
  console.log("🎯 Keystroke Dynamics: Enrollment skipped by user");
  safeClosePopup(1500);
});

// Disable enroll button initially until all steps are complete
document.getElementById("enrollBtn").disabled = true;

// =============================
// LOGOUT FUNCTIONALITY
// =============================
logoutBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove(['loggedIn', 'keyshield_jwt']);
  statusMsg.textContent = "✅ Logged out successfully!";
  
  // Reset UI to login state
  passwordLogin.style.display = "block";
  emailStep.style.display = "none";
  otpStep.style.display = "none";
  enrollmentSection.style.display = "none";
  
  // Clear form fields
  document.getElementById("username").value = "";
  document.getElementById("password").value = "";
  document.getElementById("email").value = "";
  document.getElementById("otp").value = "";
  
  // Reset all enrollment fields
  document.getElementById("enroll-password1").value = "";
  document.getElementById("enroll-password2").value = "";
  document.getElementById("enroll-password3").value = "";
  
  // Reset keystroke data
  keystrokeTimings = [];
  lastKeyTime = 0;
  enrollmentTimes = [];
  
  // Reset enrollment keystroke data
  Object.keys(enrollmentKeystrokeData).forEach(key => {
    enrollmentKeystrokeData[key] = [];
  });
  
  // Reset progress indicator
  updateProgressIndicator(1);
  
  // Notify background script
  chrome.runtime.sendMessage({ type: "logout" });
  
  console.log("🎯 Keystroke Dynamics: User logged out, reset all data");
});

// =============================
// INITIALIZATION
// =============================
// Check if user is already logged in on popup open
chrome.storage.local.get(['loggedIn'], (result) => {
  if (result.loggedIn) {
    logoutBtn.style.display = 'block';
    statusMsg.textContent = "You are already logged in. Keystroke protection active.";
    console.log("🎯 Keystroke Dynamics: User already logged in");
  }
});