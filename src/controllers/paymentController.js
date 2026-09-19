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

/*
|--------------------------------------------------------------------------
| COUPONS
|--------------------------------------------------------------------------
|
| India:
| FREE100 = 100% discount
|
| International:
| PIR = 10% discount
|
*/

const COUPONS = {
  INDIA: {
    FREE100: {
      type: "percentage",
      value: 1.0,
      currency: "INR",
    },
  },

  INTERNATIONAL: {
    PIR: {
      type: "percentage",
      value: 0.1,
    },
  },
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
| COUNTRY HELPER
|--------------------------------------------------------------------------
*/

function isIndia(country) {
  const normalized = String(country || "")
    .trim()
    .toLowerCase();

  return (
    normalized === "india" ||
    normalized === "in" ||
    normalized === "ind"
  );
}

/*
|--------------------------------------------------------------------------
| ORDER NUMBER
|--------------------------------------------------------------------------
*/

function generateOrderNumber() {
  const timestamp = Date.now();

  const random = crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase();

  return `BP-${timestamp}-${random}`;
}

/*
|--------------------------------------------------------------------------
| NORMALIZE PRODUCTS
|--------------------------------------------------------------------------
*/

function normalizeItems(items) {
  if (
    !Array.isArray(items) ||
    items.length === 0
  ) {
    throw new Error(
      "No products selected"
    );
  }

  const uniqueIds = [
    ...new Set(
      items.map(
        (item) => item.id
      )
    ),
  ];

  if (
    uniqueIds.length !==
    items.length
  ) {
    throw new Error(
      "Duplicate products are not allowed"
    );
  }

  if (uniqueIds.length > 3) {
    throw new Error(
      "Maximum 3 products can be purchased"
    );
  }

  return uniqueIds.map(
    (id) => {
      const product =
        PRODUCTS[id];

      if (!product) {
        throw new Error(
          `Invalid product: ${id}`
        );
      }

      return product;
    }
  );
}

/*
|--------------------------------------------------------------------------
| CALCULATE PRICING
|--------------------------------------------------------------------------
|
| Important:
| Coupon validation is country-specific.
|
| FREE100:
| - Only India
| - 100% discount
| - Total becomes 0
|
| PIR:
| - International
| - 10% discount
|
*/

function calculatePricing(
  products,
  couponCode,
  country
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

  /*
  |--------------------------------------------------------------------------
  | INDIA
  |--------------------------------------------------------------------------
  */

  if (isIndia(country)) {
    if (
      normalizedCoupon ===
      "FREE100"
    ) {
      discount = roundMoney(
        subtotal * 1.0
      );
    } else if (
      normalizedCoupon
    ) {
      throw new Error(
        "Invalid coupon for Indian orders. Use FREE100."
      );
    }
  }

  /*
  |--------------------------------------------------------------------------
  | INTERNATIONAL
  |--------------------------------------------------------------------------
  */

  else {
    if (
      normalizedCoupon ===
      "PIR"
    ) {
      discount = roundMoney(
        subtotal * 0.1
      );
    } else if (
      normalizedCoupon
    ) {
      throw new Error(
        "Invalid coupon for international orders. Use PIR."
      );
    }
  }

  let total = roundMoney(
    subtotal - discount
  );

  /*
  |--------------------------------------------------------------------------
  | Prevent floating-point issues
  |--------------------------------------------------------------------------
  */

  if (total < 0) {
    total = 0;
  }

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
    `http://localhost:${
      process.env.PORT || 5000
    }`;

  const downloads = [];

  for (const item of items) {
    /*
    |--------------------------------------------------------------------------
    | Check if token already exists
    |--------------------------------------------------------------------------
    |
    | Prevent duplicate tokens when verification happens more than once.
    |
    */

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

    if (
      existingTokens.length > 0
    ) {
      /*
      |--------------------------------------------------------------------------
      | Raw token cannot be recovered.
      |--------------------------------------------------------------------------
      |
      | Only SHA-256 hash is stored.
      |
      */

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

/*
|--------------------------------------------------------------------------
| CREATE ORDER
|--------------------------------------------------------------------------
*/

const createOrder = async (
  req,
  res
) => {
  let connection;

  try {
    const {
      items,
      couponCode,
      customer,
    } = req.body;

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

    for (
      const field of requiredFields
    ) {
      if (
        !customer[field]
      ) {
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

    if (
      !emailRegex.test(email)
    ) {
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

    /*
    |--------------------------------------------------------------------------
    | Calculate pricing
    |--------------------------------------------------------------------------
    */

    const pricing =
      calculatePricing(
        products,
        couponCode,
        customer.country
      );

    /*
    |--------------------------------------------------------------------------
    | FREE100 SERVER-SIDE VALIDATION
    |--------------------------------------------------------------------------
    |
    | FREE100 can ONLY:
    |
    | - be used in India
    | - have INR currency
    | - produce a zero total
    |
    */

    const isFreeOrder =
      pricing.total === 0 &&
      pricing.couponCode ===
        "FREE100" &&
      isIndia(
        customer.country
      );

    /*
    |--------------------------------------------------------------------------
    | Zero-value orders must be FREE100 India orders
    |--------------------------------------------------------------------------
    */

    if (
      pricing.total === 0 &&
      !isFreeOrder
    ) {
      throw new Error(
        "A zero-value order is only available for valid Indian FREE100 orders."
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Determine currency
    |--------------------------------------------------------------------------
    */

    const currency =
      isIndia(
        customer.country
      )
        ? "INR"
        : "USD";

    /*
    |--------------------------------------------------------------------------
    | FREE100 currency protection
    |--------------------------------------------------------------------------
    */

    if (
      pricing.couponCode ===
        "FREE100" &&
      currency !== "INR"
    ) {
      throw new Error(
        "FREE100 is available only for Indian customers."
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Generate order number
    |--------------------------------------------------------------------------
    */

    const orderNumber =
      generateOrderNumber();

    /*
    |--------------------------------------------------------------------------
    | CREATE RAZORPAY ORDER
    |--------------------------------------------------------------------------
    |
    | IMPORTANT:
    |
    | FREE100 orders do NOT go to Razorpay.
    |
    */

    let razorpayOrder =
      null;

    if (!isFreeOrder) {
      razorpayOrder =
        await razorpay.orders.create(
          {
            amount:
              Math.round(
                pricing.total *
                  100
              ),

            currency,

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
          }
        );
    }

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
    */

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

    /*
    |--------------------------------------------------------------------------
    | RAZORPAY ORDER ID / FREE ORDER ID
    |--------------------------------------------------------------------------
    */

    const databaseOrderId =
      isFreeOrder
        ? `FREE-${orderNumber}`
        : razorpayOrder.id;

    /*
    |--------------------------------------------------------------------------
    | SAVE ORDER
    |--------------------------------------------------------------------------
    */

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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        orderNumber,

        customerId,

        pricing.subtotal,

        pricing.discount,

        pricing.total,

        pricing.couponCode,

        currency,

        databaseOrderId,

        isFreeOrder
          ? "PAID"
          : "PENDING",
      ]
    );

    const orderId =
      orderResult.insertId;

    /*
    |--------------------------------------------------------------------------
    | SAVE ORDER ITEMS
    |--------------------------------------------------------------------------
    */

    const savedItems = [];

    for (
      const product of products
    ) {
      const [
        itemResult,
      ] = await connection.execute(
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

      /*
      |--------------------------------------------------------------------------
      | Keep DB item information for download token generation.
      |--------------------------------------------------------------------------
      */

      savedItems.push({
        id:
          itemResult.insertId,

        order_id:
          orderId,

        product_id:
          product.id,

        product_name:
          product.name,

        price:
          product.price,
      });
    }

    /*
    |--------------------------------------------------------------------------
    | FREE100 ORDER
    |--------------------------------------------------------------------------
    |
    | Mark as PAID and immediately create secure downloads.
    |
    */

    let downloads = [];

    let freePaymentId =
      null;

    if (isFreeOrder) {
      freePaymentId =
        `FREE100-${orderNumber}`;

      await connection.execute(
        `
          UPDATE orders
          SET
            razorpay_payment_id = ?,
            status = 'PAID',
            paid_at = NOW()
          WHERE id = ?
        `,
        [
          freePaymentId,
          orderId,
        ]
      );

      downloads =
        await createDownloadLinks(
          connection,
          orderId,
          savedItems
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
    | SEND PURCHASE EMAIL
    |--------------------------------------------------------------------------
    |
    | Email failure should never cancel the order.
    |
    */

    try {
      if (
        customer &&
        customer.email &&
        downloads.length > 0
      ) {
        const emailItems =
          savedItems
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
          await sendPurchaseEmail(
            {
              customer: {
                first_name:
                  customer.firstName,

                email:
                  email,
              },

              orderNumber,

              items:
                emailItems,

              total:
                pricing.total,
            }
          );
        }
      }
    } catch (
      emailError
    ) {
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

      message: isFreeOrder
        ? "FREE100 order completed successfully"
        : "Payment order created successfully",

      freeOrder:
        isFreeOrder,

      payment_id:
        freePaymentId,

      order:
        razorpayOrder,

      orderNumber,

      items:
        savedItems,

      downloads,

      pricing: {
        subtotal:
          pricing.subtotal,

        bundleSaving:
          pricing.bundleSaving,

        discount:
          pricing.discount,

        total:
          pricing.total,

        currency,
      },
    });
  } catch (error) {
    /*
    |--------------------------------------------------------------------------
    | ROLLBACK
    |--------------------------------------------------------------------------
    */

    if (connection) {
      try {
        await connection.rollback();
      } catch (
        rollbackError
      ) {
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
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

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

    const body =
      razorpay_order_id +
      "|" +
      razorpay_payment_id;

    const secret =
      process.env
        .RAZORPAY_KEY_SECRET;

    if (!secret) {
      console.error(
        "RAZORPAY_KEY_SECRET is not configured."
      );

      return res.status(500).json({
        success: false,
        message:
          "Payment verification is not configured.",
      });
    }

    const expectedSignature =
      crypto
        .createHmac(
          "sha256",
          secret
        )
        .update(body)
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
    | DATABASE CONNECTION
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
            total,
            currency,
            status,
            razorpay_payment_id
          FROM orders
          WHERE razorpay_order_id = ?
          LIMIT 1
        `,
        [
          razorpay_order_id,
        ]
      );

    if (
      orders.length === 0
    ) {
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
            pincode
          FROM customers
          WHERE id = ?
          LIMIT 1
        `,
        [
          order.customer_id,
        ]
      );

    const customer =
      customers[0] || null;

    /*
    |--------------------------------------------------------------------------
    | ALREADY PAID
    |--------------------------------------------------------------------------
    |
    | If Razorpay verification is sent twice,
    | do not create duplicate download tokens.
    |
    */

    if (
      order.status ===
      "PAID"
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
    | START TRANSACTION
    |--------------------------------------------------------------------------
    */

    await connection.beginTransaction();

    /*
    |--------------------------------------------------------------------------
    | MARK ORDER AS PAID
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
    | GENERATE SECURE DOWNLOAD TOKENS
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
    | COMMIT
    |--------------------------------------------------------------------------
    */

    await connection.commit();

    /*
    |--------------------------------------------------------------------------
    | SEND PURCHASE EMAIL
    |--------------------------------------------------------------------------
    |
    | Email failure does NOT fail payment.
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
                  (
                    downloadItem
                  ) =>
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
          await sendPurchaseEmail(
            {
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
            }
          );
        }
      }
    } catch (
      emailError
    ) {
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

      total:
        Number(order.total),

      customer,

      items,

      downloads,
    });
  } catch (error) {
    /*
    |--------------------------------------------------------------------------
    | ROLLBACK
    |--------------------------------------------------------------------------
    */

    if (connection) {
      try {
        await connection.rollback();
      } catch (
        rollbackError
      ) {
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