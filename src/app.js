"use strict";

const express = require("express");
const path = require("path");

const paymentRoutes = require("./routes/paymentRoutes");
const downloadRoutes = require("./routes/downloadRoutes");

const app = express();

/* =========================================================
   FRONTEND PATH
========================================================= */

const frontendPath = path.join(__dirname, "../public");

/* =========================================================
   BODY PARSERS
========================================================= */

app.use(
  express.json({
    limit: "100kb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "100kb",
  })
);

/* =========================================================
   REQUEST LOGGER
========================================================= */

app.use((req, res, next) => {
  console.log(
    `${new Date().toISOString()} ${req.method} ${req.originalUrl}`
  );

  next();
});

/* =========================================================
   API HEALTH
========================================================= */

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Business Playbook API is healthy",
    version: "2026-09-18-same-origin",
    timestamp: new Date().toISOString(),
  });
});

/* =========================================================
   API ROOT
========================================================= */

app.get("/api", (req, res) => {
  res.json({
    success: true,
    message: "Business Playbook API is running",
  });
});

/* =========================================================
   API ROUTES
========================================================= */

app.use("/api/payment", paymentRoutes);

app.use("/api/download", downloadRoutes);

/* =========================================================
   STATIC REACT FRONTEND
========================================================= */

app.use(express.static(frontendPath));

/* =========================================================
   REACT ROUTER FALLBACK
   Do not send index.html for API URLs
========================================================= */

app.get(/^\/(?!api(?:\/|$)).*/, (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

/* =========================================================
   API 404
========================================================= */

app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({
      success: false,
      message: "API route not found",
      path: req.path,
    });
  }

  next();
});

/* =========================================================
   GENERAL 404
========================================================= */

app.use((req, res) => {
  res.status(404).send("Page not found");
});

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use((err, req, res, next) => {
  console.error("❌ Server error:");
  console.error(err);

  if (req.path.startsWith("/api")) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }

  res.status(500).send("Internal server error");
});

module.exports = app;