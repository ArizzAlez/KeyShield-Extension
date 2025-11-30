// contentt.js
(function() {
  console.log("🔍 Page scan started...");

  let findings = [];

  // ============================
  // TRUSTED REAL BANK DOMAINS
  // ============================
  const TRUSTED_DOMAINS = [
    "maybank2u.com.my",
    "www.maybank2u.com.my",
    "cimbclicks.com.my",
    "www.cimbclicks.com.my",
    "rhbgroup.com",
    "www.rhbgroup.com",
    "publicbank.com.my",
    "www.publicbank.com.my",
    "hongleongconnect.my",
    "www.hongleongconnect.my",
  ];

  function isTrustedDomain(hostname) {
    return TRUSTED_DOMAINS.includes(hostname.toLowerCase());
  }

  // helper to push a structured finding with two OWASP links
  function pushFinding(title, detail, top10Url, cheatUrl) {
    const links = [];
    if (top10Url) links.push({ label: "OWASP Top 10 (details)", url: top10Url });
    if (cheatUrl) links.push({ label: "OWASP Cheat Sheet / Guidance", url: cheatUrl });
    findings.push({ title, detail, links });
  }

  // LINKS: specific OWASP pages (Top10 entries and cheatsheet/index)
  const OWASP = {
    TOP_A02: "https://owasp.org/Top10/A02_2021-Cryptographic_Failures/",
    TOP_A03: "https://owasp.org/Top10/A03_2021-Injection/",
    TOP_A04: "https://owasp.org/Top10/A04_2021-Insecure_Design/",
    TOP_A06: "https://owasp.org/Top10/A06_2021-Vulnerable_and_Outdated_Components/",
    TOP_A07: "https://owasp.org/Top10/A07_2021-Identification_and_Authentication_Failures/",
    TOP_A08: "https://owasp.org/Top10/A08_2021-Software_and_Data_Integrity_Failures/",
    TOP_A10: "https://owasp.org/Top10/A10_2021-Server-Side_Request_Forgery_%28SSRF%29/",
    CHEAT_INDEX: "https://cheatsheetseries.owasp.org/IndexTopTen.html",
    CSP_CHEAT: "https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html",
    XSS_CHEAT: "https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html"
  };

  const hostname = location.hostname;

  // --- A02: Cryptographic Failures (non-HTTPS) ---
  if (location.protocol !== "https:" && !isTrustedDomain(hostname)) {
    pushFinding(
      "Insecure transport: page not using HTTPS",
      "Page was loaded over an insecure connection (HTTP) — sensitive data may be exposed in transit.",
      OWASP.TOP_A02,
      OWASP.CHEAT_INDEX
    );
  }

  // --- Fake Bank Detector (Anti-Phishing) ---
  const FAKE_BANK_PATTERNS = /(maybank|cimb|rhb|publicbank|hlb).*?(login|secure|verify)/i;
  if (!isTrustedDomain(hostname) && FAKE_BANK_PATTERNS.test(hostname)) {
    pushFinding(
      "⚠️ Possible fake banking site!",
      `This site looks like a bank domain but is NOT trusted: ${hostname}`,
      OWASP.TOP_A07,
      OWASP.CHEAT_INDEX
    );
  }

  // --- A03: Injection / XSS indications ---
  const suspiciousPattern = /(<script\b|onerror=|onload=|javascript:|alert\(|<iframe\b)/i;
  try {
    if (suspiciousPattern.test(document.documentElement.innerHTML)) {
      pushFinding(
        "Suspicious script or injection indicators",
        "Page contains script-like strings or inline event handlers that may indicate XSS or injection vectors.",
        OWASP.TOP_A03,
        OWASP.XSS_CHEAT
      );
    }
  } catch (e) {
    console.warn("Could not scan full page HTML:", e);
  }

  // --- A04: Missing Content-Security-Policy (insecure design) ---
  const hasCSP = !!document.querySelector('meta[http-equiv="Content-Security-Policy"], meta[name="Content-Security-Policy"]');
  if (!hasCSP && !isTrustedDomain(hostname)) {
    pushFinding(
      "Missing Content-Security-Policy (CSP)",
      "No CSP meta tag detected — site may be more prone to XSS and inline script injection.",
      OWASP.TOP_A04,
      OWASP.CSP_CHEAT
    );
  }

  // --- A05-ish: Security misconfiguration hints (index listing / debug) ---
  try {
    const bodyText = document.body ? document.body.innerText.toLowerCase() : "";
    if ((document.title && document.title.toLowerCase().includes("index of")) || bodyText.includes("debug mode") || bodyText.includes("directory listing")) {
      pushFinding(
        "Possible security misconfiguration or directory listing",
        "Page title or content suggests directory listing / debug output which may leak sensitive data.",
        OWASP.TOP_A04,
        OWASP.CHEAT_INDEX
      );
    }
  } catch (e) { /* ignore */ }

  // --- A06: Outdated / vulnerable components (simple detection) ---
  Array.from(document.scripts).forEach(script => {
    const src = script.src || "";
    if (/jquery-(1\.)|angular-(1\.)/i.test(src)) {
      pushFinding(
        "Outdated JavaScript library detected",
        `The page includes an older library reference: ${src || "(inline)"} — consider upgrading to a supported version.`,
        OWASP.TOP_A06,
        OWASP.CHEAT_INDEX
      );
    }
  });

  // --- A07: Authentication hints (password on insecure page) ---
  if (location.protocol !== "https:" && !isTrustedDomain(hostname)) {
    const pw = document.querySelector("input[type='password']");
    if (pw) {
      pushFinding(
        "Password field on insecure (HTTP) page",
        "A password input exists while the page is not served over HTTPS — credentials could be intercepted.",
        OWASP.TOP_A07,
        OWASP.CHEAT_INDEX
      );
    }
  }

  // --- A08: Software & data integrity (scripts loaded via HTTP) ---
  Array.from(document.scripts).forEach(script => {
    const src = script.src || "";
    if (src.startsWith("http://") && !src.includes("localhost")) {
      pushFinding(
        "Script loaded over insecure channel (HTTP)",
        `External script loaded over HTTP: ${src} — code integrity not guaranteed.`,
        OWASP.TOP_A08,
        OWASP.CHEAT_INDEX
      );
    }
  });

  // --- A10: SSRF hints (forms targeting internal IPs) ---
  Array.from(document.forms).forEach(form => {
    const action = form.getAttribute("action") || "";
    if (/(127\.0\.0\.1|192\.168\.|10\.)/.test(action)) {
      pushFinding(
        "Form submits to internal IP / host",
        `Form action points to an internal IP or host: ${action} — may indicate server-side request handling to internal resources.`,
        OWASP.TOP_A10,
        OWASP.CHEAT_INDEX
      );
    }
  });

  // Send structured results
  chrome.runtime.sendMessage({ type: "report", issues: findings });
  console.log("Scan finished. Issues:", findings);
})();