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
| Manual CORS handling is used because the hosted GoDaddy environment
| previously did not return Access-Control-Allow-Origin correctly.
|
*/

const allowedOrigins = [
  "https://tresco.firm.in",
  "https://www.tresco.firm.in",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

/*
|--------------------------------------------------------------------------
| CORS MIDDLEWARE
|--------------------------------------------------------------------------
*/

app.use((req, res, next) => {
  const origin = req.headers.origin;

  /*
  |--------------------------------------------------------------------------
  | Allow only known frontend origins
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

    /*
    | Important when the response varies by Origin.
    */
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
  | Allowed request headers
  |--------------------------------------------------------------------------
  */

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  /*
  |--------------------------------------------------------------------------
  | Preflight
  |--------------------------------------------------------------------------
  |
  | The current checkout uses text/plain JSON to avoid unnecessary
  | browser preflight requests, but OPTIONS is still supported.
  |
  */

  if (req.method === "OPTIONS") {
    return res
      .status(200)
      .end();
  }

  next();
});


/*
|--------------------------------------------------------------------------
| BODY PARSERS
|--------------------------------------------------------------------------
|
| 1. text/plain
|    Used by the current Checkout.jsx to avoid CORS preflight.
|
| 2. application/json
|    Keeps normal JSON API requests working as well.
|
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


/*
|--------------------------------------------------------------------------
| HEALTH CHECK
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message:
      "Business Playbook API is running",
  });
});


/*
|--------------------------------------------------------------------------
| PAYMENT ROUTES
|--------------------------------------------------------------------------
*/

app.use(
  "/api/payment",
  paymentRoutes
);


/*
|--------------------------------------------------------------------------
| DOWNLOAD ROUTES
|--------------------------------------------------------------------------
*/

app.use(
  "/api/download",
  downloadRoutes
);


/*
|--------------------------------------------------------------------------
| 404 ROUTE
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
| GLOBAL ERROR HANDLER
|--------------------------------------------------------------------------
*/

app.use(
  (err, req, res, next) => {
    console.error(
      "API Error:",
      err
    );

    /*
    |--------------------------------------------------------------------------
    | If headers were already sent, let Express handle it.
    |--------------------------------------------------------------------------
    */

    if (res.headersSent) {
      return next(err);
    }

    res.status(500).json({
      success: false,
      message:
        "Internal server error",
    });
  }
);


module.exports = app;