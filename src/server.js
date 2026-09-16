"use strict";

require("dotenv").config();

const app = require("./app");
const { testDatabaseConnection } = require("./config/db");

const PORT = Number(process.env.PORT || 5000);

async function startServer() {
  try {
    await testDatabaseConnection();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Business Playbook API running on port ${PORT}`);
    });
  } catch (error) {
    console.error("❌ MySQL connection failed:");
    console.error(error.message);
    process.exit(1);
  }
}

startServer();