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
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests without Origin header
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.error("❌ CORS blocked origin:", origin);

    return callback(null, false);
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
  ],

  credentials: false,

  optionsSuccessStatus: 204,
};

/*
  CORS middleware MUST come before routes.
*/
app.use(cors(corsOptions));

/*
  Explicitly handle preflight requests.
*/
app.options(/.*/, cors(corsOptions));

/* =========================================================
   BODY PARSER
========================================================= */

app.use(express.json());

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Business Playbook API is running",
  });
});

/* =========================================================
   ROUTES
========================================================= */

app.use("/api/payment", paymentRoutes);

app.use("/api/download", downloadRoutes);

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use((err, req, res, next) => {
  console.error("❌ API Error:", err.message);

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

module.exports = app;