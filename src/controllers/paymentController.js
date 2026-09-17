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
    price: 19.99,
  },

  "dopamine-detox": {
    id: "dopamine-detox",
    name: "30 Day Dopamine Detox Workbook",
    price: 15.99,
  },

  "unlock-focus": {
    id: "unlock-focus",
    name: "How to Unlock Your Focus",
    price: 15.99,
  },
};


/* =========================================================
   COLLECTION
========================================================= */

const COLLECTION_PRICE = 45.00;


/* =========================================================
   COUPONS
========================================================= */

const COUPONS = {
  PIR: 0.10,
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
=========================================================

   Supports:

   1. application/json
      req.body = object

   2. text/plain
      req.body = JSON string

========================================================= */

function parseRequestBody(body) {
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch (error) {
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
   CALCULATE PRICING
========================================================= */

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
  const backendUrl =
    process.env.BACKEND_PUBLIC_URL ||
    `http://localhost:${
      process.env.PORT || 5000
    }`;

  const downloads = [];

  for (const item of items) {
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

    /*
      Existing raw token cannot be reconstructed
      because only the SHA-256 hash is stored.
    */

    if (
      existingTokens.length > 0
    ) {
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
=========================================================

   New checkout:
   - firstName
   - lastName
   - email
   - country
   - state
   - notes

   Older checkout can also provide:
   - address
   - city
   - pincode

   Address/city/pincode are optional here so the backend
   remains compatible with the latest checkout UI.

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


    /*
    |--------------------------------------------------------------------------
    | CUSTOMER
    |--------------------------------------------------------------------------
    */

    const normalizedCustomer =
      normalizeCustomer(
        customer
      );


    /*
    |--------------------------------------------------------------------------
    | PRODUCTS
    |--------------------------------------------------------------------------
    */

    const products =
      normalizeItems(items);


    /*
    |--------------------------------------------------------------------------
    | PRICING
    |--------------------------------------------------------------------------
    */

    const pricing =
      calculatePricing(
        products,
        couponCode
      );


    if (pricing.total <= 0) {
      throw new HttpError(
        "Invalid order total",
        400
      );
    }


    /*
    |--------------------------------------------------------------------------
    | RAZORPAY ORDER
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

        receipt:
          orderNumber,

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
    | DATABASE CONNECTION
    |--------------------------------------------------------------------------
    */

    connection =
      await pool.getConnection();

    await connection.beginTransaction();


    /*
    |--------------------------------------------------------------------------
    | SAVE CUSTOMER
    |--------------------------------------------------------------------------
    |
    | Address/city/pincode are kept as empty strings when not supplied.
    | This keeps compatibility with existing NOT NULL DB columns.
    |--------------------------------------------------------------------------
    */

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
          normalizedCustomer.firstName,

          normalizedCustomer.lastName,

          normalizedCustomer.email,

          normalizedCustomer.country,

          normalizedCustomer.state,

          normalizedCustomer.address,

          normalizedCustomer.city,

          normalizedCustomer.pincode,

          normalizedCustomer.notes ||
            null,
        ]
      );


    const customerId =
      customerResult.insertId;


    /*
    |--------------------------------------------------------------------------
    | SAVE ORDER
    |--------------------------------------------------------------------------
    */

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
    | SAVE ORDER ITEMS
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


    /*
    |--------------------------------------------------------------------------
    | COMMIT
    |--------------------------------------------------------------------------
    */

    await connection.commit();


    /*
    |--------------------------------------------------------------------------
    | RESPONSE
    |--------------------------------------------------------------------------
    */

    return res.status(200).json({
      success: true,

      order:
        razorpayOrder,

      orderNumber,

      pricing: {
        individualSubtotal:
          pricing.individualSubtotal,

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

    /*
    |--------------------------------------------------------------------------
    | PARSE BODY
    |--------------------------------------------------------------------------
    */

    const body =
      parseRequestBody(
        req.body
      );


    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = body;


    /*
    |--------------------------------------------------------------------------
    | VALIDATE PAYMENT DATA
    |--------------------------------------------------------------------------
    */

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


    /*
    |--------------------------------------------------------------------------
    | VERIFY SIGNATURE
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


    /*
    |--------------------------------------------------------------------------
    | DATABASE
    |--------------------------------------------------------------------------
    */

    connection =
      await pool.getConnection();


    /*
    |--------------------------------------------------------------------------
    | FIND ORDER
    |--------------------------------------------------------------------------
    */

    const [orders] =
      await connection.execute(
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


    /*
    |--------------------------------------------------------------------------
    | GET ORDER ITEMS
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
    | GET CUSTOMER
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


    /*
    |--------------------------------------------------------------------------
    | ALREADY PAID
    |--------------------------------------------------------------------------
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

        subtotal:
          Number(order.subtotal),

        discount:
          Number(order.discount),

        total:
          Number(order.total),

        customer,

        items,

        /*
          The original token cannot be recovered because
          only its SHA-256 hash is stored.
        */
        downloads: [],
      });
    }


    /*
    |--------------------------------------------------------------------------
    | TRANSACTION
    |--------------------------------------------------------------------------
    */

    await connection.beginTransaction();


    /*
    |--------------------------------------------------------------------------
    | MARK PAID
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
    | SECURE DOWNLOAD LINKS
    |--------------------------------------------------------------------------
    */

    const downloads =
      await createDownloadLinks(
        connection,
        items
      );


    /*
    |--------------------------------------------------------------------------
    | COMMIT
    |--------------------------------------------------------------------------
    */

    await connection.commit();


    /*
    |--------------------------------------------------------------------------
    | EMAIL
    |--------------------------------------------------------------------------
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
      | Payment remains successful if email fails.
      |--------------------------------------------------------------------------
      */

      console.error(
        "⚠️ Purchase email could not be sent:",
        emailError.message
      );

    }


    /*
    |--------------------------------------------------------------------------
    | FINAL RESPONSE
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