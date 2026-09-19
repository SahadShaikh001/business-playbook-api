"use strict";

const crypto = require("crypto");

const razorpay = require("../config/razorpay");
const { pool } = require("../config/db");

const {
  sendPurchaseEmail,
} = require("../services/emailService");

/* =========================================================
   PRODUCT SOURCE OF TRUTH
========================================================= */

const PRODUCTS = {
  "how-to-attract-women": {
    id: "how-to-attract-women",
    name: "How to Attract Women",

    USD: 19.99,
    INR: 499,
  },

  "dopamine-detox": {
    id: "dopamine-detox",
    name: "30 Day Dopamine Detox Workbook",

    USD: 15.99,
    INR: 299,
  },

  "unlock-focus": {
    id: "unlock-focus",
    name: "How to Unlock Your Focus",

    USD: 15.99,
    INR: 299,
  },
};

/* =========================================================
   COLLECTION / BUNDLE
========================================================= */

const COLLECTION_PRICE = {
  USD: 45.00,
  INR: 999,
};

/* =========================================================
   COUPONS
========================================================= */

const COUPONS = {
  INDIA: {
    PLAYBOOK5: 0.05,
  },

  INTERNATIONAL: {
    PIR: 0.10,
  },
};

/* =========================================================
   DOWNLOAD TOKEN EXPIRY
========================================================= */

const DOWNLOAD_TOKEN_EXPIRY_DAYS = Number(
  process.env.DOWNLOAD_TOKEN_EXPIRY_DAYS || 30
);

/* =========================================================
   CUSTOM HTTP ERROR
========================================================= */

class HttpError extends Error {
  constructor(message, statusCode = 400) {
    super(message);

    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

/* =========================================================
   MONEY
========================================================= */

function roundMoney(value) {
  return (
    Math.round(
      (Number(value) + Number.EPSILON) * 100
    ) / 100
  );
}

/* =========================================================
   PARSE REQUEST BODY
========================================================= */

function parseRequestBody(body) {
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      throw new HttpError(
        "Invalid request body",
        400
      );
    }
  }

  if (!body || typeof body !== "object") {
    throw new HttpError(
      "Invalid request body",
      400
    );
  }

  return body;
}

/* =========================================================
   COUNTRY / CURRENCY
========================================================= */

function isIndia(country) {
  return (
    String(country || "")
      .trim()
      .toLowerCase() === "india"
  );
}

function getCurrencyForCountry(country) {
  return isIndia(country) ? "INR" : "USD";
}

function getCurrencySymbol(currency) {
  return currency === "INR" ? "₹" : "$";
}

/* =========================================================
   RAZORPAY AMOUNT
========================================================= */

function toRazorpayAmount(value) {
  return Math.round(
    Number(value) * 100
  );
}

/* =========================================================
   ORDER NUMBER
========================================================= */

function generateOrderNumber() {
  const timestamp = Date.now();

  const random = crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase();

  return `BP-${timestamp}-${random}`;
}

/* =========================================================
   NORMALIZE PRODUCTS
========================================================= */

function normalizeItems(items) {
  if (
    !Array.isArray(items) ||
    items.length === 0
  ) {
    throw new HttpError(
      "No products selected",
      400
    );
  }

  const productIds = items.map((item) =>
    String(item?.id || "").trim()
  );

  if (
    productIds.some(
      (id) => !id
    )
  ) {
    throw new HttpError(
      "Invalid product selection",
      400
    );
  }

  const uniqueIds = [
    ...new Set(productIds),
  ];

  if (
    uniqueIds.length !==
    productIds.length
  ) {
    throw new HttpError(
      "Duplicate products are not allowed",
      400
    );
  }

  if (uniqueIds.length > 3) {
    throw new HttpError(
      "Maximum 3 products can be purchased",
      400
    );
  }

  return uniqueIds.map((id) => {
    const product = PRODUCTS[id];

    if (!product) {
      throw new HttpError(
        `Invalid product: ${id}`,
        400
      );
    }

    return product;
  });
}

/* =========================================================
   COUPON
========================================================= */

function getCouponDiscount({
  country,
  couponCode,
  subtotal,
}) {
  const normalizedCoupon = String(
    couponCode || ""
  )
    .trim()
    .toUpperCase();

  if (!normalizedCoupon) {
    return {
      couponCode: null,
      couponRate: 0,
      discount: 0,
    };
  }

  const couponGroup = isIndia(country)
    ? COUPONS.INDIA
    : COUPONS.INTERNATIONAL;

  if (
    !Object.prototype.hasOwnProperty.call(
      couponGroup,
      normalizedCoupon
    )
  ) {
    throw new HttpError(
      isIndia(country)
        ? "Invalid coupon code for Indian orders."
        : "Invalid coupon code for international orders.",
      400
    );
  }

  const couponRate = Number(
    couponGroup[normalizedCoupon]
  );

  const discount = roundMoney(
    Number(subtotal) * couponRate
  );

  return {
    couponCode: normalizedCoupon,
    couponRate,
    discount,
  };
}

/* =========================================================
   CALCULATE PRICING
========================================================= */

function calculatePricing(
  products,
  country,
  couponCode
) {
  const currency =
    getCurrencyForCountry(country);

  const individualSubtotal =
    roundMoney(
      products.reduce(
        (sum, product) =>
          sum +
          Number(
            product[currency]
          ),
        0
      )
    );

  const isCompleteCollection =
    products.length === 3;

  const subtotal =
    isCompleteCollection
      ? Number(
          COLLECTION_PRICE[currency]
        )
      : individualSubtotal;

  const bundleSaving =
    isCompleteCollection
      ? roundMoney(
          individualSubtotal -
            subtotal
        )
      : 0;

  const coupon =
    getCouponDiscount({
      country,
      couponCode,
      subtotal,
    });

  const total = roundMoney(
    subtotal -
      coupon.discount
  );

  if (total <= 0) {
    throw new HttpError(
      "Invalid order total",
      400
    );
  }

  return {
    currency,

    currencySymbol:
      getCurrencySymbol(currency),

    isCompleteCollection,

    individualSubtotal,

    subtotal,

    bundleSaving,

    couponCode:
      coupon.couponCode,

    couponRate:
      coupon.couponRate,

    discount:
      coupon.discount,

    total,
  };
}

/* =========================================================
   DOWNLOAD TOKEN HELPERS
========================================================= */

function generateDownloadToken() {
  return crypto
    .randomBytes(32)
    .toString("hex");
}

function hashDownloadToken(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

function getDownloadExpiryDate() {
  const expiryDays =
    Number.isFinite(
      DOWNLOAD_TOKEN_EXPIRY_DAYS
    ) &&
    DOWNLOAD_TOKEN_EXPIRY_DAYS > 0
      ? DOWNLOAD_TOKEN_EXPIRY_DAYS
      : 30;

  return new Date(
    Date.now() +
      expiryDays *
        24 *
        60 *
        60 *
        1000
  );
}

/* =========================================================
   CREATE SECURE DOWNLOAD LINKS
========================================================= */

async function createDownloadLinks(
  connection,
  items
) {
  const backendUrl = (
    process.env.BACKEND_PUBLIC_URL ||
    "https://tresco.firm.in"
  ).replace(/\/+$/, "");

  const downloads = [];

  for (const item of items) {
    const [
      existingTokens,
    ] = await connection.execute(
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

    /*
     * Existing raw token cannot be recovered
     * because only the SHA-256 hash is stored.
     */
    if (existingTokens.length > 0) {
      continue;
    }

    const rawToken =
      generateDownloadToken();

    const tokenHash =
      hashDownloadToken(
        rawToken
      );

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

/* =========================================================
   CUSTOMER NORMALIZATION
========================================================= */

function normalizeCustomer(customer) {
  if (!customer) {
    throw new HttpError(
      "Customer details are required",
      400
    );
  }

  const firstName =
    String(
      customer.firstName || ""
    ).trim();

  const lastName =
    String(
      customer.lastName || ""
    ).trim();

  const email =
    String(
      customer.email || ""
    )
      .trim()
      .toLowerCase();

  const country =
    String(
      customer.country || ""
    ).trim();

  const state =
    String(
      customer.state || ""
    ).trim();

  const address =
    String(
      customer.address || ""
    ).trim();

  const city =
    String(
      customer.city || ""
    ).trim();

  const pincode =
    String(
      customer.pincode || ""
    ).trim();

  const notes =
    String(
      customer.notes || ""
    ).trim();

  if (!firstName) {
    throw new HttpError(
      "firstName is required",
      400
    );
  }

  if (!lastName) {
    throw new HttpError(
      "lastName is required",
      400
    );
  }

  if (!email) {
    throw new HttpError(
      "email is required",
      400
    );
  }

  if (!country) {
    throw new HttpError(
      "country is required",
      400
    );
  }

  if (!state) {
    throw new HttpError(
      "state is required",
      400
    );
  }

  const emailRegex =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(email)) {
    throw new HttpError(
      "Invalid email address",
      400
    );
  }

  return {
    firstName,
    lastName,
    email,
    country,
    state,
    address,
    city,
    pincode,
    notes,
  };
}

/* =========================================================
   CREATE ORDER
========================================================= */

const createOrder = async (
  req,
  res
) => {
  let connection = null;

  try {
    const body =
      parseRequestBody(
        req.body
      );

    const {
      items,
      couponCode,
      customer,
    } = body;

    /* ================================================
       CUSTOMER
    ================================================ */

    const normalizedCustomer =
      normalizeCustomer(
        customer
      );

    /* ================================================
       PRODUCTS
    ================================================ */

    const products =
      normalizeItems(items);

    /* ================================================
       PRICING
    ================================================ */

    const pricing =
      calculatePricing(
        products,
        normalizedCustomer.country,
        couponCode
      );

    /* ================================================
       ORDER NUMBER
    ================================================ */

    const orderNumber =
      generateOrderNumber();

    /* ================================================
       RAZORPAY ORDER
    ================================================ */

    const razorpayOrder =
      await razorpay.orders.create({
        amount:
          toRazorpayAmount(
            pricing.total
          ),

        /*
         * India:
         * INR
         *
         * International:
         * USD
         */
        currency:
          pricing.currency,

        receipt:
          orderNumber,

        notes: {
          order_number:
            orderNumber,

          customer_email:
            normalizedCustomer.email,

          customer_country:
            normalizedCustomer.country,

          pricing_type:
            pricing.isCompleteCollection
              ? "BUNDLE"
              : "INDIVIDUAL",

          coupon_code:
            pricing.couponCode || "",
        },
      });

    /* ================================================
       DATABASE CONNECTION
    ================================================ */

    connection =
      await pool.getConnection();

    await connection.beginTransaction();

    /* ================================================
       CUSTOMER
    ================================================ */

    const [
      customerResult,
    ] = await connection.execute(
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
        normalizedCustomer.firstName,

        normalizedCustomer.lastName,

        normalizedCustomer.email,

        normalizedCustomer.country,

        normalizedCustomer.state,

        normalizedCustomer.address,

        normalizedCustomer.city,

        normalizedCustomer.pincode,

        normalizedCustomer.notes || null,
      ]
    );

    const customerId =
      customerResult.insertId;

    /* ================================================
       ORDER
    ================================================ */

    const [
      orderResult,
    ] = await connection.execute(
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

        pricing.currency,

        razorpayOrder.id,
      ]
    );

    const orderId =
      orderResult.insertId;

    /* ================================================
       ORDER ITEMS
    ================================================ */

    for (const product of products) {
      const itemPrice =
        Number(
          product[
            pricing.currency
          ]
        );

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

          itemPrice,
        ]
      );
    }

    /* ================================================
       COMMIT
    ================================================ */

    await connection.commit();

    /* ================================================
       RESPONSE
    ================================================ */

    return res.status(200).json({
      success: true,

      order:
        razorpayOrder,

      orderNumber,

      pricing: {
        currency:
          pricing.currency,

        currencySymbol:
          pricing.currencySymbol,

        individualSubtotal:
          pricing.individualSubtotal,

        subtotal:
          pricing.subtotal,

        bundleSaving:
          pricing.bundleSaving,

        couponCode:
          pricing.couponCode,

        couponRate:
          pricing.couponRate,

        discount:
          pricing.discount,

        total:
          pricing.total,
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

    const statusCode =
      error instanceof HttpError
        ? error.statusCode
        : 500;

    return res
      .status(statusCode)
      .json({
        success: false,

        message:
          error instanceof HttpError
            ? error.message
            : "Unable to create payment order",
      });

  } finally {
    if (connection) {
      connection.release();
    }
  }
};

/* =========================================================
   VERIFY PAYMENT
========================================================= */

const verifyPayment = async (
  req,
  res
) => {
  let connection = null;

  try {
    const body =
      parseRequestBody(
        req.body
      );

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = body;

    /* ================================================
       VALIDATION
    ================================================ */

    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      throw new HttpError(
        "Missing payment details",
        400
      );
    }

    /* ================================================
       VERIFY SIGNATURE
    ================================================ */

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
      throw new HttpError(
        "Invalid payment signature",
        400
      );
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
      throw new HttpError(
        "Invalid payment signature",
        400
      );
    }

    /* ================================================
       DATABASE
    ================================================ */

    connection =
      await pool.getConnection();

    const [
      orders,
    ] = await connection.execute(
      `
        SELECT
          id,
          order_number,
          customer_id,
          subtotal,
          discount,
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
      throw new HttpError(
        "Order not found",
        404
      );
    }

    const order =
      orders[0];

    /* ================================================
       ALREADY PAID
    ================================================ */

    if (
      order.status === "PAID"
    ) {
      const [
        items,
      ] = await connection.execute(
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

        subtotal:
          Number(order.subtotal),

        discount:
          Number(order.discount),

        total:
          Number(order.total),

        items,

        downloads: [],
      });
    }

    /* ================================================
       CUSTOMER
    ================================================ */

    const [
      customers,
    ] = await connection.execute(
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
          pincode,
          notes
        FROM customers
        WHERE id = ?
        LIMIT 1
      `,
      [order.customer_id]
    );

    const customer =
      customers[0] || null;

    /* ================================================
       ORDER ITEMS
    ================================================ */

    const [
      items,
    ] = await connection.execute(
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

    /* ================================================
       TRANSACTION
    ================================================ */

    await connection.beginTransaction();

    /* ================================================
       MARK PAID
    ================================================ */

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

    /* ================================================
       DOWNLOAD LINKS
    ================================================ */

    const downloads =
      await createDownloadLinks(
        connection,
        items
      );

    /* ================================================
       COMMIT
    ================================================ */

    await connection.commit();

    /* ================================================
       PURCHASE EMAIL
    ================================================ */

    try {
      if (
        customer &&
        customer.email
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

          items,

          total:
            order.total,

          currency:
            order.currency,
        });
      }
    } catch (emailError) {
      console.error(
        "⚠️ Purchase email could not be sent:",
        emailError.message
      );
    }

    /* ================================================
       RESPONSE
    ================================================ */

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

      subtotal:
        Number(order.subtotal),

      discount:
        Number(order.discount),

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

    const statusCode =
      error instanceof HttpError
        ? error.statusCode
        : 500;

    return res
      .status(statusCode)
      .json({
        success: false,

        message:
          error instanceof HttpError
            ? error.message
            : "Payment verification failed",
      });

  } finally {
    if (connection) {
      connection.release();
    }
  }
};

/* =========================================================
   EXPORT
========================================================= */

module.exports = {
  createOrder,
  verifyPayment,
};