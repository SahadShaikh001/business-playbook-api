"use strict";

const express = require("express");

const {
  downloadBook,
} = require("../controllers/downloadController");

const router = express.Router();

router.get("/:token", downloadBook);

module.exports = router;