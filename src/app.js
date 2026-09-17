"use strict";

const express = require("express");

const paymentRoutes = require("./routes/paymentRoutes");
const downloadRoutes = require("./routes/downloadRoutes");

const app = express();

/*
|--------------------------------------------------------------------------
| CORS
|--------------------------------------------------------------------------
|
| Manual CORS handling is used because the hosted OPTIONS response was
| not returning Access-Control-Allow-Origin correctly.
|
*/

const allowedOrigins = [
  "https://tresco.firm.in",
  "https://www.tresco.firm.in",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  /*
  |--------------------------------------------------------------------------
  | Preflight
  |--------------------------------------------------------------------------
  */

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  next();
});

/*
|--------------------------------------------------------------------------
| Body parser
|--------------------------------------------------------------------------
|
| Checkout requests use text/plain intentionally to avoid browser
| CORS preflight caused by application/json.
|
*/

app.use(express.text({ type: "text/plain" }));
app.use(express.json());

/*
|--------------------------------------------------------------------------
| Health check
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Business Playbook API is running",
  });
});

/*
|--------------------------------------------------------------------------
| Routes
|--------------------------------------------------------------------------
*/

app.use("/api/payment", paymentRoutes);
app.use("/api/download", downloadRoutes);

/*
|--------------------------------------------------------------------------
| 404
|--------------------------------------------------------------------------
*/

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

/*
|--------------------------------------------------------------------------
| Error handler
|--------------------------------------------------------------------------
*/

app.use((err, req, res, next) => {
  console.error("API Error:", err);

  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

module.exports = app;