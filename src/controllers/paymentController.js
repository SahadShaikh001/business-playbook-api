"use strict";

const crypto = require("crypto");
const razorpay = require("../config/razorpay");
const { pool } = require("../config/db");

const {
  sendPurchaseEmail,
} = require("../services/emailService");

/*
|--------------------------------------------------------------------------
| PRODUCT SOURCE OF TRUTH
|--------------------------------------------------------------------------
*/

const PRODUCTS = {
  "how-to-attract-women": {
    id: "how-to-attract-women",
    name: "How to Attract Women",
    price: 19.99,
  },

  "dopamine-detox": {
    id: "dopamine-detox",
    name: "30 Day Dopamine Detox Workbook",
    price: 15.0,
  },

  "unlock-focus": {
    id: "unlock-focus",
    name: "How to Unlock Your Focus",
    price: 15.0,
  },
};

const COLLECTION_PRICE = 45.0;

const COUPONS = {
  PIR: 0.10,
};

const DOWNLOAD_TOKEN_EXPIRY_DAYS = Number(
  process.env.DOWNLOAD_TOKEN_EXPIRY_DAYS || 30
);

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

function roundMoney(value) {
  return (
    Math.round(
      (Number(value) + Number.EPSILON) * 100
    ) / 100
  );
}

/*
|--------------------------------------------------------------------------
| PARSE REQUEST BODY
|--------------------------------------------------------------------------
|
| Checkout frontend sends JSON as text/plain to avoid the browser CORS
| preflight problem on the hosted GoDaddy environment.
|
| This helper supports BOTH:
|
| 1. Normal application/json -> req.body is already an object
| 2. text/plain JSON       -> req.body is a string
|
*/

function parseRequestBody(body) {
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch (error) {
      throw new Error("Invalid request body");
    }
  }

  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body");
  }

  return body;
}

function generateOrderNumber() {
  const timestamp = Date.now();

  const random = crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase();

  return `BP-${timestamp}-${random}`;
}

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("No products selected");
  }

  const uniqueIds = [
    ...new Set(
      items.map((item) => item.id)
    ),
  ];

  if (uniqueIds.length !== items.length) {
    throw new Error(
      "Duplicate products are not allowed"
    );
  }

  if (uniqueIds.length > 3) {
    throw new Error(
      "Maximum 3 products can be purchased"
    );
  }

  return uniqueIds.map((id) => {
    const product = PRODUCTS[id];

    if (!product) {
      throw new Error(
        `Invalid product: ${id}`
      );
    }

    return product;
  });
}

function calculatePricing(
  products,
  couponCode
) {
  const individualSubtotal =
    roundMoney(
      products.reduce(
        (sum, product) =>
          sum + product.price,
        0
      )
    );

  const isCompleteCollection =
    products.length === 3;

  const subtotal =
    isCompleteCollection
      ? COLLECTION_PRICE
      : individualSubtotal;

  const bundleSaving =
    isCompleteCollection
      ? roundMoney(
          individualSubtotal -
            COLLECTION_PRICE
        )
      : 0;

  const normalizedCoupon =
    String(couponCode || "")
      .trim()
      .toUpperCase();

  let discount = 0;

  if (
    normalizedCoupon &&
    COUPONS[normalizedCoupon]
  ) {
    discount = roundMoney(
      subtotal *
        COUPONS[normalizedCoupon]
    );
  }

  const total = roundMoney(
    subtotal - discount
  );

  return {
    individualSubtotal,
    subtotal,
    bundleSaving,
    discount,
    total,
    couponCode:
      normalizedCoupon || null,
  };
}

/*
|--------------------------------------------------------------------------
| SECURE DOWNLOAD TOKEN HELPERS
|--------------------------------------------------------------------------
*/

function generateDownloadToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashDownloadToken(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

function getDownloadExpiryDate() {
  return new Date(
    Date.now() +
      DOWNLOAD_TOKEN_EXPIRY_DAYS *
        24 *
        60 *
        60 *
        1000
  );
}

/*
|--------------------------------------------------------------------------
| CREATE SECURE DOWNLOAD LINKS
|--------------------------------------------------------------------------
*/

async function createDownloadLinks(
  connection,
  orderId,
  items
) {
  const backendUrl =
    process.env.BACKEND_PUBLIC_URL ||
    `http://localhost:${process.env.PORT || 5000}`;

  const downloads = [];

  for (const item of items) {
    /*
    |--------------------------------------------------------------------------
    | Check if token already exists
    |--------------------------------------------------------------------------
    |
    | This protects against duplicate payment verification.
    |
    */

    const [existingTokens] =
      await connection.execute(
        `
        SELECT
          id,
          expires_at,
          download_count,
          max_downloads
        FROM download_tokens
        WHERE order_item_id = ?
        LIMIT 1
        `,
        [item.id]
      );

    if (
      existingTokens.length > 0
    ) {
      /*
      |--------------------------------------------------------------------------
      | Existing token
      |--------------------------------------------------------------------------
      |
      | The raw token cannot be recovered because only its SHA-256 hash
      | is stored in the database.
      |
      */

      continue;
    }

    const rawToken =
      generateDownloadToken();

    const tokenHash =
      hashDownloadToken(rawToken);

    const expiresAt =
      getDownloadExpiryDate();

    await connection.execute(
      `
      INSERT INTO download_tokens
      (
        order_item_id,
        token_hash,
        expires_at,
        download_count,
        max_downloads
      )
      VALUES (?, ?, ?, 0, 5)
      `,
      [
        item.id,
        tokenHash,
        expiresAt,
      ]
    );

    downloads.push({
      productId:
        item.product_id,

      productName:
        item.product_name,

      url:
        `${backendUrl}/api/download/${rawToken}`,

      expiresAt:
        expiresAt.toISOString(),

      maxDownloads: 5,
    });
  }

  return downloads;
}

/*
|--------------------------------------------------------------------------
| CREATE RAZORPAY ORDER
|--------------------------------------------------------------------------
*/

const createOrder = async (
  req,
  res
) => {
  let connection;

  try {
    /*
    |--------------------------------------------------------------------------
    | Parse request body
    |--------------------------------------------------------------------------
    */

    const body =
      parseRequestBody(req.body);

    const {
      items,
      couponCode,
      customer,
    } = body;

    /*
    |--------------------------------------------------------------------------
    | Validate customer
    |--------------------------------------------------------------------------
    */

    if (!customer) {
      return res.status(400).json({
        success: false,
        message:
          "Customer details are required",
      });
    }

    const requiredFields = [
      "firstName",
      "lastName",
      "email",
      "country",
      "address",
      "city",
      "pincode",
    ];

    for (const field of requiredFields) {
      if (!customer[field]) {
        return res.status(400).json({
          success: false,
          message:
            `${field} is required`,
        });
      }
    }

    /*
    |--------------------------------------------------------------------------
    | Validate email
    |--------------------------------------------------------------------------
    */

    const email = String(
      customer.email
    )
      .trim()
      .toLowerCase();

    const emailRegex =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid email address",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Validate products
    |--------------------------------------------------------------------------
    */

    const products =
      normalizeItems(items);

    const pricing =
      calculatePricing(
        products,
        couponCode
      );

    if (pricing.total <= 0) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid order total",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Create Razorpay order
    |--------------------------------------------------------------------------
    */

    const orderNumber =
      generateOrderNumber();

    const razorpayOrder =
      await razorpay.orders.create({
        amount: Math.round(
          pricing.total * 100
        ),

        currency: "USD",

        receipt: orderNumber,

        notes: {
          order_number:
            orderNumber,

          products:
            products
              .map(
                (product) =>
                  product.id
              )
              .join(","),
        },
      });

    /*
    |--------------------------------------------------------------------------
    | Save customer + order
    |--------------------------------------------------------------------------
    */

    connection =
      await pool.getConnection();

    await connection.beginTransaction();

    const [customerResult] =
      await connection.execute(
        `
        INSERT INTO customers
        (
          first_name,
          last_name,
          email,
          country,
          state,
          address,
          city,
          pincode,
          notes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          customer.firstName,
          customer.lastName,
          email,
          customer.country,
          customer.state ||
            null,
          customer.address,
          customer.city,
          customer.pincode,
          customer.notes ||
            null,
        ]
      );

    const customerId =
      customerResult.insertId;

    const [orderResult] =
      await connection.execute(
        `
        INSERT INTO orders
        (
          order_number,
          customer_id,
          subtotal,
          discount,
          total,
          coupon_code,
          currency,
          razorpay_order_id,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
        `,
        [
          orderNumber,
          customerId,
          pricing.subtotal,
          pricing.discount,
          pricing.total,
          pricing.couponCode,
          "USD",
          razorpayOrder.id,
        ]
      );

    const orderId =
      orderResult.insertId;

    /*
    |--------------------------------------------------------------------------
    | Save order items
    |--------------------------------------------------------------------------
    */

    for (const product of products) {
      await connection.execute(
        `
        INSERT INTO order_items
        (
          order_id,
          product_id,
          product_name,
          price
        )
        VALUES (?, ?, ?, ?)
        `,
        [
          orderId,
          product.id,
          product.name,
          product.price,
        ]
      );
    }

    await connection.commit();

    /*
    |--------------------------------------------------------------------------
    | Response
    |--------------------------------------------------------------------------
    */

    return res.status(200).json({
      success: true,

      order:
        razorpayOrder,

      orderNumber,

      pricing: {
        subtotal:
          pricing.subtotal,

        bundleSaving:
          pricing.bundleSaving,

        discount:
          pricing.discount,

        total:
          pricing.total,

        currency: "USD",
      },
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error(
          "Rollback error:",
          rollbackError
        );
      }
    }

    console.error(
      "Create order error:",
      error
    );

    return res.status(400).json({
      success: false,
      message:
        error.message ||
        "Unable to create payment order",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

/*
|--------------------------------------------------------------------------
| VERIFY PAYMENT
|--------------------------------------------------------------------------
*/

const verifyPayment = async (
  req,
  res
) => {
  let connection;

  try {
    /*
    |--------------------------------------------------------------------------
    | Parse request body
    |--------------------------------------------------------------------------
    */

    const body =
      parseRequestBody(req.body);

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = body;

    /*
    |--------------------------------------------------------------------------
    | Validate payment details
    |--------------------------------------------------------------------------
    */

    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing payment details",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Verify Razorpay signature
    |--------------------------------------------------------------------------
    */

    const signatureBody =
      razorpay_order_id +
      "|" +
      razorpay_payment_id;

    const expectedSignature =
      crypto
        .createHmac(
          "sha256",
          process.env.RAZORPAY_KEY_SECRET
        )
        .update(signatureBody)
        .digest("hex");

    const receivedSignature =
      String(
        razorpay_signature
      );

    if (
      expectedSignature.length !==
      receivedSignature.length
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid payment signature",
      });
    }

    const isValid =
      crypto.timingSafeEqual(
        Buffer.from(
          expectedSignature,
          "utf8"
        ),
        Buffer.from(
          receivedSignature,
          "utf8"
        )
      );

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid payment signature",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Database connection
    |--------------------------------------------------------------------------
    */

    connection =
      await pool.getConnection();

    /*
    |--------------------------------------------------------------------------
    | Find order
    |--------------------------------------------------------------------------
    */

    const [orders] =
      await connection.execute(
        `
        SELECT
          id,
          order_number,
          customer_id,
          total,
          currency,
          status,
          razorpay_payment_id
        FROM orders
        WHERE razorpay_order_id = ?
        LIMIT 1
        `,
        [razorpay_order_id]
      );

    if (orders.length === 0) {
      return res.status(404).json({
        success: false,
        message:
          "Order not found",
      });
    }

    const order =
      orders[0];

    /*
    |--------------------------------------------------------------------------
    | Get order items
    |--------------------------------------------------------------------------
    */

    const [items] =
      await connection.execute(
        `
        SELECT
          id,
          product_id,
          product_name,
          price
        FROM order_items
        WHERE order_id = ?
        ORDER BY id ASC
        `,
        [order.id]
      );

    /*
    |--------------------------------------------------------------------------
    | Get customer
    |--------------------------------------------------------------------------
    */

    const [customers] =
      await connection.execute(
        `
        SELECT
          id,
          first_name,
          last_name,
          email,
          country,
          state,
          address,
          city,
          pincode
        FROM customers
        WHERE id = ?
        LIMIT 1
        `,
        [order.customer_id]
      );

    const customer =
      customers[0] || null;

    /*
    |--------------------------------------------------------------------------
    | Already PAID
    |--------------------------------------------------------------------------
    |
    | If verification is sent again, don't create duplicate tokens.
    |
    */

    if (
      order.status === "PAID"
    ) {
      return res.status(200).json({
        success: true,

        message:
          "Payment already verified",

        payment_id:
          order.razorpay_payment_id ||
          razorpay_payment_id,

        order_id:
          razorpay_order_id,

        orderNumber:
          order.order_number,

        currency:
          order.currency,

        total:
          Number(order.total),

        customer,

        items,

        downloads: [],
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Start transaction
    |--------------------------------------------------------------------------
    */

    await connection.beginTransaction();

    /*
    |--------------------------------------------------------------------------
    | Mark order as PAID
    |--------------------------------------------------------------------------
    */

    await connection.execute(
      `
      UPDATE orders
      SET
        razorpay_payment_id = ?,
        razorpay_signature = ?,
        status = 'PAID',
        paid_at = NOW()
      WHERE id = ?
      `,
      [
        razorpay_payment_id,
        razorpay_signature,
        order.id,
      ]
    );

    /*
    |--------------------------------------------------------------------------
    | Generate secure download tokens
    |--------------------------------------------------------------------------
    */

    const downloads =
      await createDownloadLinks(
        connection,
        order.id,
        items
      );

    /*
    |--------------------------------------------------------------------------
    | Commit payment + download tokens
    |--------------------------------------------------------------------------
    */

    await connection.commit();

    /*
    |--------------------------------------------------------------------------
    | SEND PURCHASE EMAIL
    |--------------------------------------------------------------------------
    |
    | Email is sent AFTER database commit.
    |
    */

    try {
      if (
        customer &&
        customer.email &&
        downloads.length > 0
      ) {
        const emailItems =
          items
            .map((item) => {
              const download =
                downloads.find(
                  (downloadItem) =>
                    downloadItem.productId ===
                    item.product_id
                );

              if (!download) {
                return null;
              }

              return {
                product_name:
                  item.product_name,

                download_url:
                  download.url,
              };
            })
            .filter(Boolean);

        if (
          emailItems.length > 0
        ) {
          await sendPurchaseEmail({
            customer: {
              first_name:
                customer.first_name,

              email:
                customer.email,
            },

            orderNumber:
              order.order_number,

            items:
              emailItems,

            total:
              order.total,
          });
        }
      }
    } catch (emailError) {
      /*
      |--------------------------------------------------------------------------
      | Do NOT fail payment because email failed.
      |--------------------------------------------------------------------------
      */

      console.error(
        "⚠️ Purchase email could not be sent:",
        emailError.message
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Final response
    |--------------------------------------------------------------------------
    */

    return res.status(200).json({
      success: true,

      message:
        "Payment verified successfully",

      payment_id:
        razorpay_payment_id,

      order_id:
        razorpay_order_id,

      orderNumber:
        order.order_number,

      currency:
        order.currency,

      total:
        Number(order.total),

      customer,

      items,

      downloads,
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error(
          "Rollback error:",
          rollbackError
        );
      }
    }

    console.error(
      "Payment verification error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Payment verification failed",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

/*
|--------------------------------------------------------------------------
| EXPORT
|--------------------------------------------------------------------------
*/

module.exports = {
  createOrder,
  verifyPayment,
};