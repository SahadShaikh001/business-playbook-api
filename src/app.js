"use strict";

const express = require("express");
const cors = require("cors");

const paymentRoutes = require("./routes/paymentRoutes");
const downloadRoutes = require("./routes/downloadRoutes");

const app = express();

// CORS
app.use(
  cors({
    origin: "https://tresco.firm.in/",
  })
);

// JSON request body
app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Business Playbook API is running",
  });
});

// Payment APIs
app.use("/api/payment", paymentRoutes);

// Secure download APIs
app.use("/api/download", downloadRoutes);

module.exports = app;