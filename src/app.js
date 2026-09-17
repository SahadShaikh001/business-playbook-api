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
    // Allow requests without an Origin header
    // (Postman, curl, server-to-server, etc.)
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.warn("CORS blocked origin:", origin);

    return callback(new Error("Not allowed by CORS"));
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
};

/*
 * CORS middleware
 */
app.use(cors(corsOptions));

/*
 * Explicit OPTIONS handling for browser preflight requests
 */
app.options(/.*/, cors(corsOptions));

/* =========================================================
   BODY PARSER
========================================================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
   ROOT
========================================================= */

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Business Playbook API is running",
  });
});

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Business Playbook API is healthy",
    timestamp: new Date().toISOString(),
  });
});

/* =========================================================
   PAYMENT ROUTES
========================================================= */

app.use("/api/payment", paymentRoutes);

/* =========================================================
   DOWNLOAD ROUTES
========================================================= */

app.use("/api/download", downloadRoutes);

/* =========================================================
   404
========================================================= */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API endpoint not found",
    path: req.originalUrl,
  });
});

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use((err, req, res, next) => {
  console.error("API Error:", err);

  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({
      success: false,
      message: "CORS origin is not allowed",
    });
  }

  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

module.exports = app;