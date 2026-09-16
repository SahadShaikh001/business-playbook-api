"use strict";

require("dotenv").config();

const app = require("./app");
const {
  testDatabaseConnection,
} = require("./config/db");

const PORT =
  process.env.PORT || 5000;

async function startServer() {
  try {
    await testDatabaseConnection();

    app.listen(PORT, () => {
      console.log(
        `Server running on http://localhost:${PORT}`
      );
    });
  } catch (error) {
    console.error(
      "❌ MySQL connection failed:"
    );

    console.error(error.message);

    process.exit(1);
  }
}

startServer();