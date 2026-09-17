"use strict";

const express = require("express");

const {
  createOrder,
  verifyPayment,
} = require("../controllers/paymentController");

const router = express.Router();


/* =========================================================
   CREATE PAYMENT ORDER
========================================================= */

router.post(
  "/create-order",
  createOrder
);


/* =========================================================
   VERIFY PAYMENT
========================================================= */

router.post(
  "/verify-payment",
  verifyPayment
);


module.exports = router;