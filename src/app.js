"use strict";

const express = require("express");
const cors = require("cors");

const paymentRoutes = require("./routes/paymentRoutes");
const downloadRoutes = require("./routes/downloadRoutes");

const app = express();

/* =========================================================
   CORS
========================================================= */

const allowedOrigins = [
  "https://tresco.firm.in",
  "https://www.tresco.firm.in",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests without Origin, such as curl/server-to-server
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(
      new Error(`CORS blocked origin: ${origin}`)
    );
  },

  methods: [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
  ],

  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept",
    "Origin",
    "X-Requested-With",
  ],

  credentials: false,

  optionsSuccessStatus: 204,

  maxAge: 86400,
};

app.use(cors(corsOptions));

/* =========================================================
   BODY PARSERS
========================================================= */

/*
 * Frontend sends checkout JSON using text/plain
 * to avoid unnecessary browser preflight behavior.
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

  if (req.headers.origin) {
    console.log(
      `Origin: ${req.headers.origin}`
    );
  }

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
    timestamp: new Date().toISOString(),
  });
});

/* =========================================================
   PAYMENT
========================================================= */

app.use(
  "/api/payment",
  paymentRoutes
);

/* =========================================================
   DOWNLOAD
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

  if (
    err.message &&
    err.message.startsWith("CORS blocked origin:")
  ) {
    return res.status(403).json({
      success: false,
      message: "CORS origin not allowed",
    });
  }

  res.status(500).json({
    success: false,
    message:
      err.message ||
      "Internal server error",
  });
});

module.exports = app;