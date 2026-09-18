"use strict";

const express = require("express");

const paymentRoutes = require("./routes/paymentRoutes");
const downloadRoutes = require("./routes/downloadRoutes");

const app = express();


/* =========================================================
   ALLOWED ORIGINS
========================================================= */

const allowedOrigins = [
  "https://tresco.firm.in",
  "https://www.tresco.firm.in",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];


/* =========================================================
   CORS
========================================================= */

app.use((req, res, next) => {
  const origin = req.headers.origin;

  /*
  |--------------------------------------------------------------------------
  | Allow known frontend origins
  |--------------------------------------------------------------------------
  */

  if (
    origin &&
    allowedOrigins.includes(origin)
  ) {
    res.setHeader(
      "Access-Control-Allow-Origin",
      origin
    );

    res.setHeader(
      "Vary",
      "Origin"
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Allowed methods
  |--------------------------------------------------------------------------
  */

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );

  /*
  |--------------------------------------------------------------------------
  | Allowed headers
  |--------------------------------------------------------------------------
  */

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Accept, Origin, X-Requested-With"
  );

  /*
  |--------------------------------------------------------------------------
  | Preflight cache
  |--------------------------------------------------------------------------
  */

  res.setHeader(
    "Access-Control-Max-Age",
    "86400"
  );

  /*
  |--------------------------------------------------------------------------
  | OPTIONS / PREFLIGHT
  |--------------------------------------------------------------------------
  */

  if (req.method === "OPTIONS") {
    return res
      .status(204)
      .end();
  }

  next();
});


/* =========================================================
   BODY PARSERS
=========================================================

   IMPORTANT:

   Checkout currently sends:

       Content-Type: text/plain

   with a JSON string inside the body.

   Therefore express.text() MUST be registered.

   express.json() remains enabled so normal JSON requests
   continue to work.

========================================================= */


/*
|--------------------------------------------------------------------------
| TEXT/PLAIN
|--------------------------------------------------------------------------
*/

app.use(
  express.text({
    type: "text/plain",
    limit: "100kb",
  })
);


/*
|--------------------------------------------------------------------------
| JSON
|--------------------------------------------------------------------------
*/

app.use(
  express.json({
    limit: "100kb",
  })
);


/*
|--------------------------------------------------------------------------
| URL ENCODED
|--------------------------------------------------------------------------
*/

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
  res.status(200).json({
    success: true,
    message:
      "Business Playbook API is running",
  });
});


/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message:
      "Business Playbook API is healthy",

    timestamp:
      new Date().toISOString(),
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

    message:
      "API endpoint not found",

    path:
      req.originalUrl,
  });
});


/* =========================================================
   GLOBAL ERROR HANDLER
========================================================= */

app.use(
  (err, req, res, next) => {
    console.error(
      "API Error:",
      err
    );

    if (res.headersSent) {
      return next(err);
    }

    /*
    |--------------------------------------------------------------------------
    | CORS on error responses
    |--------------------------------------------------------------------------
    */

    const origin =
      req.headers.origin;

    if (
      origin &&
      allowedOrigins.includes(origin)
    ) {
      res.setHeader(
        "Access-Control-Allow-Origin",
        origin
      );

      res.setHeader(
        "Vary",
        "Origin"
      );
    }

    res.status(500).json({
      success: false,

      message:
        "Internal server error",
    });
  }
);


module.exports = app;