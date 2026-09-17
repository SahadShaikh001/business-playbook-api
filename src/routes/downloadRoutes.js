"use strict";

const express = require("express");

const {
  downloadBook,
} = require("../controllers/downloadController");

const router = express.Router();


/*
|--------------------------------------------------------------------------
| SECURE BOOK DOWNLOAD
|--------------------------------------------------------------------------
|
| Example:
| GET /api/download/<secure-token>
|
*/

router.get(
  "/:token",
  downloadBook
);


module.exports = router;