"use strict";

const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

async function sendPurchaseEmail({
  customer,
  orderNumber,
  items,
  total,
}) {
  const downloadLinks = items
    .map(
      (item) => `
        <div style="
          margin-bottom:20px;
          padding:18px;
          border:1px solid #e5e5e5;
          border-radius:10px;
        ">
          <h3 style="
            margin:0 0 10px;
            color:#111;
          ">
            ${item.product_name}
          </h3>

          <a
            href="${item.download_url}"
            style="
              display:inline-block;
              padding:11px 18px;
              background:#111;
              color:#fff;
              text-decoration:none;
              border-radius:6px;
              font-size:14px;
            "
          >
            DOWNLOAD BOOK
          </a>
        </div>
      `
    )
    .join("");

  const mailOptions = {
    from:
      process.env.SMTP_FROM ||
      `"Business Playbook" <${process.env.SMTP_USER}>`,

    to: customer.email,

    subject: `Your Business Playbook order #${orderNumber}`,

    html: `
      <!DOCTYPE html>
      <html>
        <body style="
          margin:0;
          padding:0;
          background:#f7f4ed;
          font-family:Arial, sans-serif;
          color:#111;
        ">

          <div style="
            max-width:650px;
            margin:40px auto;
            background:#fff;
            padding:40px;
            border-radius:12px;
          ">

            <h1 style="
              margin:0 0 8px;
              font-size:28px;
            ">
              Business Playbook
            </h1>

            <p style="
              color:#777;
              margin-top:0;
            ">
              Your purchase is confirmed.
            </p>

            <hr style="
              border:0;
              border-top:1px solid #eee;
              margin:25px 0;
            " />

            <p>
              Hi ${customer.first_name},
            </p>

            <p>
              Thank you for your purchase.
              Your payment has been successfully completed.
            </p>

            <p>
              <strong>Order:</strong> #${orderNumber}<br />
              <strong>Total:</strong> $${Number(total).toFixed(2)}
            </p>

            <h2 style="
              margin-top:30px;
              font-size:20px;
            ">
              Your books
            </h2>

            ${downloadLinks}

            <p style="
              margin-top:30px;
              font-size:13px;
              color:#777;
              line-height:1.6;
            ">
              Your download links are valid for 30 days
              and allow up to 5 downloads.
              Please keep this email safe.
            </p>

            <hr style="
              border:0;
              border-top:1px solid #eee;
              margin:30px 0 20px;
            " />

            <p style="
              font-size:12px;
              color:#999;
            ">
              Business Playbook<br />
              This is an automated purchase confirmation email.
            </p>

          </div>

        </body>
      </html>
    `,
  };

  await transporter.sendMail(mailOptions);

  console.log(
    `✅ Purchase email sent to ${customer.email}`
  );
}

module.exports = {
  sendPurchaseEmail,
};