// extractor.js (improved)
// Put this file at backend/extractor.js replacing the old file.

// --- add near top of extractor.js ---
function isAllCapsLine(s) {
  // treat short all-caps lines with punctuation (labels) as noise
  const t = (s || '').trim();
  if (!t) return false;
  // If more than 70% of letters are uppercase and length < 60, treat as label/header
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (!letters) return false;
  const uppers = letters.replace(/[^A-Z]/g, '').length;
  return (uppers / letters.length) > 0.7 && t.length < 80;
}

function preprocessPdfText(raw) {
  if (!raw) return raw;
  const lines = raw.split(/\r?\n/);
  const keep = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // remove obvious template placeholders
    if (!line) continue;
    if (/^(PHONE|PRIMARY|SECONDARY|CELL|BUS|OWNER'S|DRIVER'S|AUTOMOBILE LOSS NOTICE|DATE OF LOSS|PHONE #|V\.I\.N\.|POLICY)$/i.test(line)) continue;

    // remove lines that are mostly all-caps and short (likely labels)
    if (isAllCapsLine(line) && line.split(/\s+/).length <= 6) continue;

    // remove lines that are just words like 'Y / N' or 'Y N' or repeated short tokens
    if (/^(Y\s*\/\s*N|Y\s*N|NAI|NA)$/i.test(line)) continue;

    // remove lines that are just numbers/dashes or very short
    if (/^[\d\-\s\/:]{1,20}$/.test(line)) continue;

    // remove repeated single-word header lines (e.g., 'LOSS', 'DESCRIPTION')
    if (/^[A-Z]{2,10}$/.test(line) && line.length < 12) continue;

    // otherwise keep
    keep.push(line);
  }

  // join paragraphs: if a line ends with '-' (hyphenated break), join without space
  let cleaned = keep.map(l => l.replace(/-\s*$/, '')).join('\n');

  // Collapse multiple blank lines
  cleaned = cleaned.replace(/\n{2,}/g, '\n\n');

  // normalize spaces
  cleaned = cleaned.replace(/[ \t]{2,}/g, ' ').trim();

  return cleaned;
}


const { parseISO, isValid } = require('date-fns');

const FAST_TRACK_THRESHOLD = 25000;
const INVESTIGATION_KEYWORDS = ["fraud", "fraudulent", "staged", "inconsistent", "suspect", "suspicious"];
const MANDATORY_FIELDS = [
  "Policy Number",
  "Policyholder Name",
  "Effective Dates",
  "Date",
  "Location",
  "Description",
  "Claimant",
  "Claim Type",
  "Attachments",
  "Initial Estimate"
];

function compact(s = '') {
  return String(s).replace(/\r/g, ' ').replace(/\t/g, ' ').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}

function findLineMatch(regex, rawText) {
  // Look line-by-line to avoid greedy cross-line matches
  const lines = rawText.split(/\r?\n/);
  for (const line of lines) {
    const m = regex.exec(line);
    if (m) return (m[1] || m[0]).trim();
  }
  return null;
}

function findAnyMatch(regex, rawText) {
  const m = regex.exec(rawText);
  return m ? (m[1] || m[0]).trim() : null;
}

function parseAmount(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[₹,]/g, '').trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function inferClaimType(text) {
  const t = compact(text).toLowerCase();
  if (/\binjury\b|\binjured\b|\bhospital\b/.test(t)) return 'injury';
  if (/\btheft\b|\bstolen\b/.test(t)) return 'theft';
  if (/\bvehicle\b|\bcar\b|\btruck\b|\bmotorcycle\b|\bbike\b/.test(t)) return 'vehicle';
  if (/\bproperty\b|\bhouse\b|\bhome\b/.test(t)) return 'property';
  return null;
}

function extractAndRoute(rawText) {
  rawText = rawText || '';
  const compactText = compact(rawText);

  const extracted = {
    "Policy Number": null,
    "Policyholder Name": null,
    "Effective Dates": null,
    "Date": null,
    "Time": null,
    "Location": null,
    "Description": null,
    "Claimant": null,
    "Third Parties": null,
    "Contact Details": { email: null, phone: null },
    "Asset Type": null,
    "Asset ID": null,
    "Estimated Damage": null,
    "Claim Type": null,
    "Attachments": null,
    "Initial Estimate": null
  };

  // --- Policy info (line-level)
  extracted["Policy Number"] = findLineMatch(/\bPolicy(?:\s*No(?:\.)?|(?:\s*Number)|):?\s*([A-Z0-9\-\/]+)/i, rawText);
  extracted["Policyholder Name"] = findLineMatch(/\bPolicyholder(?: Name)?\s*:?\s*([A-Za-z ,.'-]{2,100})$/i, rawText);

  // Effective dates: capture two date tokens on same line (dd-MMM-yyyy or similar)
  // Example: Effective Dates: 01-Jan-2024 to 31-Dec-2024
  const eff = findLineMatch(/\bEffective(?: Dates| Date)?\s*:?\s*(.+)/i, rawText);
  if (eff) {
    const rangeMatch = /([0-3]?\d[-\/][A-Za-z0-9-]+)\s*(?:to|-)\s*([0-3]?\d[-\/][A-Za-z0-9-]+)/i.exec(eff);
    if (rangeMatch) {
      extracted["Effective Dates"] = { from: rangeMatch[1].trim(), to: rangeMatch[2].trim() };
    } else {
      extracted["Effective Dates"] = eff;
    }
  }

// Date: try to extract a single date token from the "Date" line (dd-MMM-YYYY, dd/mm/yyyy, YYYY-MM-DD, or 'Month dd, yyyy')
const dateLine = findLineMatch(/\b(?:Date of Loss|Date)\s*:?\s*(.+)/i, rawText);
if (dateLine) {
  // find a date token inside the captured line
  const tokenMatch = dateLine.match(/([0-3]?\d[-\/][A-Za-z0-9-]+[-\/]\d{2,4}|\d{4}-\d{2}-\d{2}|\b[A-Za-z]{3,9}\s+\d{1,2},?\s*\d{2,4}\b)/);
  const dateToken = tokenMatch ? tokenMatch[0] : dateLine;
  try {
    const iso = parseISO(dateToken);
    if (isValid(iso)) extracted["Date"] = iso.toISOString();
    else extracted["Date"] = dateToken;
  } catch (e) {
    extracted["Date"] = dateToken;
  }
}


  // Time: line-level
  extracted["Time"] = findLineMatch(/\b(?:Time|Time of Loss)\s*:?\s*([0-2]?\d[:.][0-5]\d(?:\s*[APMapm]{2})?)/i, rawText);

  // Location: line-level; fallback: look for "Location:" or a line containing "Location" word
  extracted["Location"] = findLineMatch(/\bLocation\s*:?\s*(.+)/i, rawText) || (function(){
    const m = findAnyMatch(/\bat\s+([A-Z][A-Za-z0-9 ,\-]+)/i, rawText);
    return m || null;
  })();

  // Description: look for "Description" block (multi-line) or take the paragraph containing keywords
  const descBlock = /(?:Description|Incident Description|Details)\s*:?\s*([\s\S]{20,1200})/i.exec(rawText);
  if (descBlock) {
    // stop at next blank line if possible
    const textAfter = descBlock[1].split(/\r?\n\r?\n/)[0];
    extracted["Description"] = textAfter.trim();
  } else {
    // choose paragraph with keywords
    const paras = rawText.split(/\r?\n\r?\n/);
    for (const p of paras) {
      if (/\b(loss|damage|incident|collision|theft|injury|stolen)\b/i.test(p)) {
        extracted["Description"] = p.trim();
        break;
      }
    }
  }

  // Parties & contact (line-level)
  extracted["Claimant"] = findLineMatch(/(?:Claimant|Insured|Complainant)\s*:?\s*([A-Za-z ,.'-]{2,100})$/i, rawText) || extracted["Policyholder Name"];
  const tp = findLineMatch(/\bThird(?: |-)?Party\s*:?\s*(.+)/i, rawText);
  extracted["Third Parties"] = tp || null;
  const email = findAnyMatch(/[\w.\-]+@[\w.\-]+\.\w+/i, rawText);
  const phone = findLineMatch(/\b(?:Phone|Contact|Tel|Mobile)\s*:?\s*([\+\d\-\s\(\)]{7,20})/i, rawText) || findAnyMatch(/(\+?\d[\d\-\s\(\)]{6,}\d)/, rawText);
  extracted["Contact Details"] = { email: email || null, phone: phone || null };

  // Asset
  if (/\b(car|vehicle|truck|motorcycle|bike|van|auto)\b/i.test(compactText)) extracted["Asset Type"] = "vehicle";
  else if (/\b(house|home|property|building|apartment|flat)\b/i.test(compactText)) extracted["Asset Type"] = "property";
  extracted["Asset ID"] = findLineMatch(/(?:Asset\s*ID|VIN|Registration|Reg\.?)\s*:?\s*([A-Z0-9\-]{3,50})/i, rawText);

  // Estimates (line-level)
  const estRaw = findLineMatch(/(?:Estimated\s+Damage|Initial Estimate|Estimate|Estimated\s+Loss)\s*:?\s*₹?\s*([\d,]+(?:\.\d{1,2})?)/i, rawText);
  extracted["Estimated Damage"] = estRaw ? parseAmount(estRaw) : null;
  extracted["Initial Estimate"] = estRaw || findLineMatch(/\bInitial Estimate\s*:?\s*(.+)/i, rawText) || null;

  // Claim Type & Attachments (line-level, stop at line end)
  extracted["Claim Type"] = (findLineMatch(/(?:Claim\s*Type|Type of Claim)\s*:?\s*([A-Za-z ]{3,30})$/i, rawText) || inferClaimType(compactText) || null);
  extracted["Attachments"] = findLineMatch(/(?:Attachments|Attached)\s*:?\s*(.+)$/i, rawText) || (/\b(attachments|attached|photos|images|police report|fir)\b/i.test(compactText) ? "Yes" : null);

  // --- Missing & inconsistent checks ---
  const missing = [];
  for (const f of MANDATORY_FIELDS) {
    const val = extracted[f];
    if (val === null || val === undefined || (typeof val === 'string' && val.trim() === '')) missing.push(f);
  }
  const inconsistent = [];
  // Date vs Effective dates check (if effective dates in from/to form)
  try {
    if (extracted["Date"] && extracted["Effective Dates"] && typeof extracted["Effective Dates"] === 'object') {
      const docDate = parseISO(extracted["Date"]);
      const from = parseISO(extracted["Effective Dates"].from);
      const to = parseISO(extracted["Effective Dates"].to);
      if (isValid(docDate) && isValid(from) && isValid(to)) {
        if (!(from <= docDate && docDate <= to)) inconsistent.push("Date is outside Effective Dates");
      }
    }
  } catch (e) {}
  if (extracted["Estimated Damage"] !== null && extracted["Estimated Damage"] < 0) inconsistent.push("Estimated Damage negative");

  // --- Routing ---
  let recommendedRoute = "Standard processing";
  const reasons = [];
  if (missing.length > 0) {
    recommendedRoute = "Manual review";
    reasons.push("One or more mandatory fields missing");
  } else {
    // Investigation check in description
    const descLower = (extracted["Description"] || "").toLowerCase();
    const inv = INVESTIGATION_KEYWORDS.find(k => descLower.includes(k));
    if (inv) {
      recommendedRoute = "Investigation";
      reasons.push(`Description contains '${inv}'`);
    } else if (extracted["Claim Type"] && String(extracted["Claim Type"]).toLowerCase() === "injury") {
      recommendedRoute = "Specialist Queue";
      reasons.push("Claim type = injury");
    } else if (typeof extracted["Estimated Damage"] === 'number') {
      if (extracted["Estimated Damage"] < FAST_TRACK_THRESHOLD) {
        recommendedRoute = "Fast-track";
        reasons.push(`Estimated damage (${extracted["Estimated Damage"]}) < ${FAST_TRACK_THRESHOLD}`);
      } else {
        recommendedRoute = "Standard processing";
        reasons.push(`Estimated damage (${extracted["Estimated Damage"]}) >= ${FAST_TRACK_THRESHOLD}`);
      }
    } else {
      recommendedRoute = "Standard processing";
      reasons.push("Estimated damage unknown -> Standard processing");
    }
  }

  const reasoning = reasons.join(" ; ")
    + (inconsistent.length ? " ; Inconsistencies: " + inconsistent.join(", ") : "")
    + (missing.length ? " ; Missing fields: " + missing.join(", ") : "");

  return {
    extractedFields: extracted,
    missingFields: missing,
    inconsistentFields: inconsistent,
    recommendedRoute,
    reasoning
  };
}

module.exports = { extractAndRoute };
