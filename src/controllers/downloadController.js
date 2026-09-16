"use strict";

const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { pool } = require("../config/db");

const BOOK_FILES = {
  "how-to-attract-women": {
    filename: "how-to-attract-women.pdf",
  },

  "dopamine-detox": {
    filename: "dopamine-detox.pdf",
  },

  "unlock-focus": {
    filename: "unlock-focus.pdf",
  },
};

const downloadBook = async (req, res) => {
  try {
    const { token } = req.params;

    if (!token || token.length < 20) {
      return res.status(400).json({
        success: false,
        message: "Invalid download link",
      });
    }

    // Hash the token received from the customer.
    // Only the hash is stored in the database.
    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const [rows] = await pool.query(
      `
      SELECT
        dt.id AS download_token_id,
        dt.expires_at,
        dt.download_count,
        dt.max_downloads,
        oi.product_id,
        oi.product_name,
        o.status AS order_status
      FROM download_tokens dt
      INNER JOIN order_items oi
        ON oi.id = dt.order_item_id
      INNER JOIN orders o
        ON o.id = oi.order_id
      WHERE dt.token_hash = ?
      LIMIT 1
      `,
      [tokenHash]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Download link is invalid or has expired",
      });
    }

    const download = rows[0];

    // Payment must be completed.
    if (download.order_status !== "PAID") {
      return res.status(403).json({
        success: false,
        message: "Payment is not completed",
      });
    }

    // Check expiry.
    if (
      download.expires_at &&
      new Date(download.expires_at).getTime() < Date.now()
    ) {
      return res.status(410).json({
        success: false,
        message: "Download link has expired",
      });
    }

    // Check download limit.
    if (download.download_count >= download.max_downloads) {
      return res.status(403).json({
        success: false,
        message: "Download limit reached",
      });
    }

    // Never allow product_id to directly become a file path.
    // Only predefined products can be downloaded.
    const book = BOOK_FILES[download.product_id];

    if (!book) {
      return res.status(404).json({
        success: false,
        message: "Book file not found",
      });
    }

    const filePath = path.join(
      __dirname,
      "../../storage/books",
      book.filename
    );

    if (!fs.existsSync(filePath)) {
      console.error(
        "Book file missing:",
        filePath
      );

      return res.status(404).json({
        success: false,
        message: "Book file is currently unavailable",
      });
    }

    // Increment download count BEFORE sending the file.
    await pool.query(
      `
      UPDATE download_tokens
      SET
        download_count = download_count + 1,
        last_downloaded_at = NOW()
      WHERE id = ?
      `,
      [download.download_token_id]
    );

    res.download(
      filePath,
      book.filename,
      (error) => {
        if (error) {
          console.error(
            "File download error:",
            error
          );
        }
      }
    );
  } catch (error) {
    console.error(
      "Download controller error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Unable to download the book",
    });
  }
};

module.exports = {
  downloadBook,
};