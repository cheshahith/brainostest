require("dotenv").config();

const express = require("express");
const path = require("node:path");
const PDFDocument = require("pdfkit");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const LIMIT_WINDOW_MS = 60 * 60 * 1000;
const LIMIT_PER_IP = 5;
const requestsByIp = new Map();
const DIMENSIONS = [
  "Focus & Concentration",
  "Confidence & Self-Belief",
  "Decision-Making",
  "Money Mindset",
  "Mental Clarity & Emotional Awareness"
];
const REFLECTIONS = [
  "What is one distraction you could remove from your day, and what would you do with the focus you win back?",
  "If self-doubt were not in the room, which opportunity would you say yes to this week?",
  "Which decision are you delaying right now, and what is the smallest step you could take today?",
  "What story do you tell yourself about what you are allowed to earn, and where did you first hear it?",
  "Which emotion shows up most often just before you react, and what might it be trying to tell you?"
];

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

app.get(["/", "/brainos.html"], (req, res) => {
  res.sendFile(path.join(__dirname, "brainos.html"));
});

app.post("/api/report", async (req, res) => {
  const now = Date.now();
  const ip = req.ip;
  const recentRequests = (requestsByIp.get(ip) || []).filter((time) => now - time < LIMIT_WINDOW_MS);
  if (recentRequests.length >= LIMIT_PER_IP) {
    return res.status(429).json({ error: "Too many report requests. Please try again later." });
  }
  recentRequests.push(now);
  requestsByIp.set(ip, recentRequests);

  const config = {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    apiVersion: process.env.WHATSAPP_API_VERSION,
    recipient: process.env.WHATSAPP_TO,
    templateName: process.env.WHATSAPP_TEMPLATE_NAME,
    templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE
  };
  if (Object.values(config).some((value) => !value)) {
    return res.status(503).json({ error: "WhatsApp delivery is not configured on the server." });
  }
  if (!/^v\d+\.\d+$/.test(config.apiVersion) || !/^\d+$/.test(config.phoneNumberId) || !/^\d{8,15}$/.test(config.recipient)) {
    return res.status(503).json({ error: "WhatsApp server configuration is invalid." });
  }

  const { consent, name, overall, dimensions } = req.body || {};
  const validName = typeof name === "string" && name.trim().length > 0 && name.trim().length <= 80;
  const validOverall = Number.isInteger(overall) && overall >= 0 && overall <= 100;
  const validDimensions = dimensions && typeof dimensions === "object" && !Array.isArray(dimensions) &&
    Object.keys(dimensions).length === DIMENSIONS.length &&
    DIMENSIONS.every((dimension) => Number.isInteger(dimensions[dimension]) && dimensions[dimension] >= 0 && dimensions[dimension] <= 100);
  if (consent !== true || !validName || !validOverall || !validDimensions) {
    return res.status(400).json({ error: "The report data or consent is invalid." });
  }

  try {
    const report = { name: name.trim(), overall, dimensions };
    const pdf = await createReportPdf(report);
    const media = await uploadPdf(config, pdf);
    await sendDocumentTemplate(config, media.id);
    return res.json({ sent: true });
  } catch (error) {
    console.error("WhatsApp report delivery failed:", error.message);
    return res.status(502).json({ error: "WhatsApp could not accept the report. Please try again later." });
  }
});

function createReportPdf(report) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margin: 52 });
    const chunks = [];
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);

    const printableName = report.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "").trim();
    const highestIndex = DIMENSIONS.reduce((best, _, index) =>
      report.dimensions[DIMENSIONS[index]] > report.dimensions[DIMENSIONS[best]] ? index : best, 0);
    const category = report.overall <= 33 ? "EMERGING AWARENESS" : report.overall <= 66 ? "PATTERNS TO EXPLORE" : "PRIORITY FOR EXPLORATION";

    document.fillColor("#1C1A14").font("Helvetica-Bold").fontSize(21).text("BRAIN.OS Assessment Report");
    document.moveDown(0.5).font("Helvetica").fontSize(11).text("THE BRAIN.OS INSTITUTE");
    document.moveDown(1.5).font("Helvetica-Bold").fontSize(13).text("Participant");
    document.font("Helvetica").fontSize(11).text(printableName || "Participant");
    document.moveDown().font("Helvetica-Bold").fontSize(13).text("Overall score");
    document.font("Helvetica").fontSize(11).text(`${report.overall}% - ${category}`);
    document.moveDown().font("Helvetica-Bold").fontSize(13).text("Score by area");

    DIMENSIONS.forEach((dimension) => {
      document.font("Helvetica").fontSize(11).text(`${dimension}: ${report.dimensions[dimension]}%`);
    });

    document.moveDown().font("Helvetica-Bold").fontSize(13).text(`Area to explore: ${DIMENSIONS[highestIndex]}`);
    document.moveDown(0.3).font("Helvetica").fontSize(11).text(REFLECTIONS[highestIndex], { width: 490 });
    document.moveDown(2).fontSize(9).fillColor("#666666").text(
      "For self-reflection and awareness only. This assessment is not a clinical or psychological diagnosis.",
      { width: 490 }
    );
    document.end();
  });
}

async function uploadPdf(config, pdf) {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", new Blob([pdf], { type: "application/pdf" }), "BrainOS-Assessment-Report.pdf");
  const response = await fetch(`https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.accessToken}` },
    body: form
  });
  const result = await response.json();
  if (!response.ok || !result.id) throw new Error(result.error?.message || "WhatsApp media upload failed.");
  return result;
}

async function sendDocumentTemplate(config, mediaId) {
  const response = await fetch(`https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: config.recipient,
      type: "template",
      template: {
        name: config.templateName,
        language: { code: config.templateLanguage },
        components: [{
          type: "header",
          parameters: [{ type: "document", document: { id: mediaId, filename: "BrainOS-Assessment-Report.pdf" } }]
        }]
      }
    })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "WhatsApp message send failed.");
  return result;
}

app.listen(PORT, () => {
  console.log(`BrainOS app listening on http://localhost:${PORT}`);
});
