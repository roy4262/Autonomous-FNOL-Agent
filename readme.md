# Autonomous Insurance Claims Processing Agent

**Purpose (Assessment brief mapping)**

This repository contains a lightweight agent that ingests FNOL (First Notice of Loss) documents (PDF/TXT/raw text), extracts required fields, detects missing or inconsistent values, classifies claims per routing rules, and returns a concise JSON result that includes the extraction, missing fields, the recommended route, and a short reasoning string.

This README documents how the current implementation satisfies the assessment brief, how to run the backend, and how to test with the included sample documents.

**Repository**

```
autonomous-fnol-agent/
├── backend/
│   ├── app.js                 # Express server and upload/parse endpoints
│   ├── extractor.js           # Field extraction, validation, and routing logic
│   ├── package.json           # Node.js dependencies and start scripts
   │   ├── sample_fnols/       # Example FNOL documents (TXT/PDF)
│   └── uploads/               # Temporary upload folder (auto-created)
└── readme.md                  # This file
```

**Files provided**

- `backend/app.js` - HTTP API: `/api/parse-text` and `/api/upload`. Handles file saving, PDF parsing (via `pdf-parse`), and delegates text to `extractor.js`.
- `backend/extractor.js` - Implements extraction, mandatory field checks, inconsistency checks, and routing rules (fast-track/manual-review/investigation/specialist).
- `backend/sample_fnols/` - 3 example FNOL text files for manual testing.

**Fields the agent extracts (per brief)**

- Policy Information: `Policy Number`, `Policyholder Name`, `Effective Dates`
- Incident Information: `Date`, `Time`, `Location`, `Description`
- Involved Parties: `Claimant`, `Third Parties`, `Contact Details` (email, phone)
- Asset Details: `Asset Type`, `Asset ID`, `Estimated Damage`
- Other Mandatory Fields: `Claim Type`, `Attachments`, `Initial Estimate`

Routing rules implemented

- If `Estimated Damage` < 25,000 → `Fast-track`
- If any mandatory field is missing → `Manual review`
- If description contains `fraud`, `inconsistent`, `staged`, etc. → `Investigation`
- If `Claim Type` = `injury` → `Specialist Queue`

Output JSON (exact required structure)

```json
{
  "extractedFields": {
    /* object with extracted fields (see Fields list) */
  },
  "missingFields": [],
  "recommendedRoute": "",
  "reasoning": ""
}
```

Example response (short):

```json
{
  "extractedFields": {
    "Policy Number": "POL-2024-001234",
    "Policyholder Name": "John Doe",
    "Effective Dates": { "from": "2024-01-01", "to": "2024-12-31" },
    "Date": "2024-06-15T00:00:00.000Z",
    "Time": "14:30",
    "Location": "123 Main St, City",
    "Description": "Minor vehicle collision at intersection",
    "Claimant": "John Doe",
    "Third Parties": null,
    "Contact Details": { "email": "john@example.com", "phone": "+1-555-0123" },
    "Asset Type": "vehicle",
    "Asset ID": "VIN-12345",
    "Estimated Damage": 15000,
    "Claim Type": "Property Damage",
    "Attachments": "Yes",
    "Initial Estimate": "15000"
  },
  "missingFields": [],
  "recommendedRoute": "Fast-track",
  "reasoning": "Estimated damage (15000) < 25000"
}
```

Getting started

Prerequisites

- `Node.js` 16+ and `npm`

  
Clone Repositary

```bash
git clone https://github.com/roy4262/Autonomous-FNOL-Agent
```

Install and run

```powershell
# From repo root
cd backend
npm install
npm run dev
```

The server listens on `http://localhost:5000` by default (or `PORT` env var).

Health check

```powershell
curl http://localhost:5000/health
```

API usage



1. Upload file (text or pdf) - PowerShell example

```powershell
Invoke-RestMethod -Uri 'http://localhost:5000/api/upload' -Method Post -Form @{ file = Get-Item '.\backend\sample_fnols\fnol1.txt' } | ConvertTo-Json -Depth 5
```

Or with `curl` (Linux/macOS or curl on Windows):

```bash
 curl -X POST http://localhost:5000/api/upload -F "file=@backend/sample_fnols/fnol1.txt"
```

PowerShell upload (PDF example):

```powershell
Invoke-RestMethod -Uri 'http://localhost:5000/api/upload' -Method Post -Form @{ file = Get-Item '.\backend\sample_fnols\fnol_sample.pdf' } | ConvertTo-Json -Depth 5

```


<img width="1493" height="796" alt="Screenshot 2025-12-11 213442" src="https://github.com/user-attachments/assets/f8e1739d-032a-4a93-9a90-2ac1977cae3a" />

Or with `curl`

```bash
 curl -X POST http://localhost:5000/api/upload -F "file=@backend/sample_fnols/fnol_sample.pdf"
```

Notes

- Uploaded files are removed after processing.

Testing with sample documents

- Example sample files are in `backend/sample_fnols/` — use the upload endpoint or the `parse-text` endpoint with file contents.

Run the bundled test runner to process all samples and write JSON outputs to `backend/test-results/`:

```powershell
node backend/scripts/test-samples.js
```

Example console output when running the script (your paths may vary):

```
Processed fnol.pdf -> C:\autonomous-fnol-agent\backend\test-results\fnol.pdf.json
Processed fnol1.txt -> C:\autonomous-fnol-agent\backend\test-results\fnol1.txt.json
Processed fnol2.txt -> C:\autonomous-fnol-agent\backend\test-results\fnol2.txt.json
Processed fnol3.txt -> C:\autonomous-fnol-agent\backend\test-results\fnol3.txt.json

All done. Results written to C:\autonomous-fnol-agent\backend\test-results

```
<img width="1020" height="410" alt="Screenshot 2025-12-11 213558" src="https://github.com/user-attachments/assets/8cb8a818-41f9-4a67-8515-93e6cc02b6cd" />


<img width="1702" height="774" alt="Screenshot 2025-12-12 114814" src="https://github.com/user-attachments/assets/5a4e9d09-27c0-459e-a78a-9b7241ec4410" />

Check the generated JSON files in `backend/test-results/` for each sample's extraction and routing output.

How extraction & routing work (brief)

- `extractor.js` preprocesses text to remove common template noise and then applies line-level and paragraph-level regex patterns to capture fields.
- Mandatory fields are checked against a constant list; missing fields trigger `Manual review`.
- Description text is scanned for investigation keywords to flag potential fraud.
- Claim type inference uses simple keyword rules (e.g., presence of `injury` → `injury`).
- Damage threshold is enforced using `FAST_TRACK_THRESHOLD = 25000`.



Troubleshooting

- If uploads return `PDF parsing not available`, run `npm install pdf-parse` and ensure Node can build dependencies.
- If fields are not extracted correctly, inspect `backend/extractor.js` and add or adjust patterns.





---

For issues, questions, or suggestions, please open an issue on the GitHub repository.

---


