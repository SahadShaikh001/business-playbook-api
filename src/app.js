"use strict";

const express = require("express");

const paymentRoutes = require("./routes/paymentRoutes");
const downloadRoutes = require("./routes/downloadRoutes");

const app = express();

/* =========================================================
   PRODUCTION CORS
========================================================= */

const FRONTEND_ORIGIN = "https://tresco.firm.in";

app.use((req, res, next) => {
  // Always allow the production frontend.
  res.setHeader(
    "Access-Control-Allow-Origin",
    FRONTEND_ORIGIN
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Accept, Origin, X-Requested-With"
  );

  res.setHeader(
    "Access-Control-Max-Age",
    "86400"
  );

  res.setHeader(
    "Vary",
    "Origin"
  );

  // Temporary diagnostic header.
  // Remove later after everything is working.
  res.setHeader(
    "X-BP-CORS-Test",
    "2026-09-18-fixed"
  );

  // Respond to browser preflight requests.
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  next();
});

/* =========================================================
   BODY PARSERS
========================================================= */

/*
 * Checkout sends JSON with Content-Type: text/plain
 * to avoid the previous hosted CORS/preflight problem.
 */
app.use(
  express.text({
    type: "text/plain",
    limit: "100kb",
  })
);

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
   REQUEST LOGGING
========================================================= */

app.use((req, res, next) => {
  console.log(
    `${new Date().toISOString()} ${req.method} ${req.originalUrl}`
  );

  console.log(
    `Origin: ${req.headers.origin || "none"}`
  );

  console.log(
    `Content-Type: ${
      req.headers["content-type"] || "none"
    }`
  );

  next();
});

/* =========================================================
   ROOT
========================================================= */

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Business Playbook API is running",
  });
});

/* =========================================================
   HEALTH
========================================================= */

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Business Playbook API is healthy",
    version: "2026-09-18-fixed-cors",
    timestamp: new Date().toISOString(),
  });
});

/* =========================================================
   CORS TEST
========================================================= */

app.get("/api/cors-test", (req, res) => {
  res.json({
    success: true,
    message: "CORS test successful",
    origin: FRONTEND_ORIGIN,
    version: "2026-09-18-fixed-cors",
    timestamp: new Date().toISOString(),
  });
});

/* =========================================================
   PAYMENT ROUTES
========================================================= */

app.use(
  "/api/payment",
  paymentRoutes
);

/* =========================================================
   DOWNLOAD ROUTES
========================================================= */

app.use(
  "/api/download",
  downloadRoutes
);

/* =========================================================
   404
========================================================= */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.originalUrl,
  });
});

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use((err, req, res, next) => {
  console.error("❌ API ERROR:");
  console.error(err);

  // Keep CORS headers on error responses too.
  res.setHeader(
    "Access-Control-Allow-Origin",
    FRONTEND_ORIGIN
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Accept, Origin, X-Requested-With"
  );

  res.setHeader(
    "Vary",
    "Origin"
  );

  res.setHeader(
    "X-BP-CORS-Test",
    "2026-09-18-fixed"
  );

  res.status(500).json({
    success: false,
    message:
      err.message || "Internal server error",
  });
});

/* =========================================================
   EXPORT
========================================================= */

module.exports = app;