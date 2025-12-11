#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
let pdfParse = null;
try {
  pdfParse = require("pdf-parse");
} catch (e) {
  console.warn(
    "pdf-parse not found - PDF files will be skipped or may not parse. Install with `npm install pdf-parse`."
  );
}

const { extractAndRoute } = require("../extractor");

async function processFile(filePath, outDir) {
  const name = path.basename(filePath);
  const ext = path.extname(name).toLowerCase();
  let text = "";
  try {
    if (ext === ".txt") {
      text = fs.readFileSync(filePath, "utf8");
    } else if (ext === ".pdf") {
      if (!pdfParse) {
        console.warn(`Skipping PDF (pdf-parse not installed): ${name}`);
        return;
      }
      const data = fs.readFileSync(filePath);
      try {
        const parsed = await pdfParse(data);
        text = parsed && parsed.text ? parsed.text : "";
      } catch (err) {
        console.error(`Failed to parse PDF ${name}:`, err.message || err);
        return;
      }
    } else {
      console.warn(`Unsupported file type, skipping: ${name}`);
      return;
    }
  } catch (err) {
    console.error(`Error reading ${name}:`, err.message || err);
    return;
  }

  const result = extractAndRoute(text || "");
  const outPath = path.join(outDir, name + ".json");
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
  console.log(`Processed ${name} -> ${outPath}`);
}

async function main() {
  const sampleDir = path.join(__dirname, "..", "sample_fnols");
  const outDir = path.join(__dirname, "..", "test-results");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const entries = fs
    .readdirSync(sampleDir)
    .filter((f) => /\.(txt|pdf)$/i.test(f));
  if (!entries.length) {
    console.log("No sample TXT/PDF files found in", sampleDir);
    return;
  }

  for (const f of entries) {
    await processFile(path.join(sampleDir, f), outDir);
  }

  console.log("All done. Results written to", outDir);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
