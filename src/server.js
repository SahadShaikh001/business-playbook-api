"use strict";

require("dotenv").config();

const app = require("./app");
const {
  testDatabaseConnection,
} = require("./config/db");


/*
|--------------------------------------------------------------------------
| PORT
|--------------------------------------------------------------------------
*/

const PORT = Number(
  process.env.PORT || 5000
);


/*
|--------------------------------------------------------------------------
| START SERVER
|--------------------------------------------------------------------------
*/

async function startServer() {
  try {

    /*
    |--------------------------------------------------------------------------
    | Test MySQL connection before starting the API
    |--------------------------------------------------------------------------
    */

    await testDatabaseConnection();


    /*
    |--------------------------------------------------------------------------
    | Start HTTP server
    |--------------------------------------------------------------------------
    */

    app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `Business Playbook API running on port ${PORT}`
        );
      }
    );

  } catch (error) {

    console.error(
      "❌ MySQL connection failed:"
    );

    console.error(
      error.message
    );

    process.exit(1);
  }
}


/*
|--------------------------------------------------------------------------
| RUN
|--------------------------------------------------------------------------
*/

startServer();