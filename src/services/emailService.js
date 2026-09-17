"use strict";

const nodemailer = require("nodemailer");

/*
|--------------------------------------------------------------------------
| SMTP TRANSPORT
|--------------------------------------------------------------------------
*/

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,

  port: Number(
    process.env.SMTP_PORT || 587
  ),

  secure:
    Number(
      process.env.SMTP_PORT
    ) === 465,

  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});


/*
|--------------------------------------------------------------------------
| SEND PURCHASE CONFIRMATION EMAIL
|--------------------------------------------------------------------------
|
| IMPORTANT:
|
| We intentionally DO NOT place the individual PDF download links
| inside the email.
|
| The customer receives a secure "ACCESS MY BOOKS" button instead.
|
| The actual book-download page should later verify the purchaser's
| email/OTP before allowing the PDF to be downloaded.
|
|--------------------------------------------------------------------------
*/

async function sendPurchaseEmail({
  customer,
  orderNumber,
  total,
}) {
  const frontendUrl =
    process.env.FRONTEND_PUBLIC_URL ||
    "https://tresco.firm.in";

  const downloadPage =
    `${frontendUrl.replace(/\/$/, "")}/my-books`;

  const firstName =
    customer?.first_name ||
    "Customer";

  const email =
    customer?.email;


  /*
  |--------------------------------------------------------------------------
  | Validate email
  |--------------------------------------------------------------------------
  */

  if (!email) {
    throw new Error(
      "Customer email is required"
    );
  }


  /*
  |--------------------------------------------------------------------------
  | MAIL OPTIONS
  |--------------------------------------------------------------------------
  */

  const mailOptions = {
    from:
      process.env.SMTP_FROM ||
      `"Business Playbook" <${process.env.SMTP_USER}>`,

    to: email,

    subject:
      `Your Business Playbook order #${orderNumber}`,

    html: `
      <!DOCTYPE html>

      <html lang="en">

        <head>
          <meta charset="UTF-8" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          />

          <title>
            Business Playbook Purchase Confirmation
          </title>
        </head>


        <body style="
          margin:0;
          padding:0;
          background:#f7f4ed;
          font-family:
            Arial,
            Helvetica,
            sans-serif;
          color:#111111;
        ">

          <!-- Outer container -->

          <div style="
            width:100%;
            padding:40px 16px;
            box-sizing:border-box;
          ">

            <!-- Email card -->

            <div style="
              max-width:650px;
              margin:0 auto;
              background:#ffffff;
              border-radius:14px;
              overflow:hidden;
              box-shadow:
                0 8px 30px
                rgba(0,0,0,0.06);
            ">


              <!-- Header -->

              <div style="
                padding:32px 36px;
                background:#111111;
                color:#ffffff;
              ">

                <div style="
                  font-size:12px;
                  letter-spacing:2px;
                  text-transform:uppercase;
                  color:#c9a45c;
                  font-weight:bold;
                  margin-bottom:8px;
                ">
                  BUSINESS PLAYBOOK
                </div>

                <h1 style="
                  margin:0;
                  font-size:30px;
                  line-height:1.2;
                  font-weight:700;
                ">
                  Purchase confirmed
                </h1>

              </div>


              <!-- Main content -->

              <div style="
                padding:36px;
              ">

                <p style="
                  margin:0 0 18px;
                  font-size:16px;
                  line-height:1.6;
                  color:#222222;
                ">
                  Hi ${firstName},
                </p>


                <p style="
                  margin:0 0 18px;
                  font-size:15px;
                  line-height:1.7;
                  color:#555555;
                ">
                  Thank you for your purchase.
                  Your Business Playbook order has
                  been successfully confirmed.
                </p>


                <!-- Order information -->

                <div style="
                  margin:24px 0;
                  padding:20px;
                  background:#f7f4ed;
                  border:1px solid #e9e2d5;
                  border-radius:10px;
                ">

                  <div style="
                    margin-bottom:8px;
                    font-size:14px;
                    color:#666666;
                  ">
                    Order number
                  </div>

                  <div style="
                    font-size:17px;
                    font-weight:bold;
                    color:#111111;
                  ">
                    #${orderNumber}
                  </div>


                  <div style="
                    margin-top:18px;
                    margin-bottom:8px;
                    font-size:14px;
                    color:#666666;
                  ">
                    Total paid
                  </div>

                  <div style="
                    font-size:20px;
                    font-weight:bold;
                    color:#111111;
                  ">
                    $${Number(total).toFixed(2)}
                  </div>

                </div>


                <!-- Secure book access -->

                <div style="
                  margin:30px 0;
                  padding:28px 22px;
                  text-align:center;
                  background:#111111;
                  border-radius:12px;
                ">

                  <div style="
                    margin-bottom:10px;
                    font-size:22px;
                    line-height:1.3;
                    font-weight:bold;
                    color:#ffffff;
                  ">
                    Your books are ready
                  </div>


                  <p style="
                    margin:0 auto 22px;
                    max-width:470px;
                    font-size:14px;
                    line-height:1.7;
                    color:#cccccc;
                  ">
                    Access your purchased books from
                    our secure download page.
                    Your purchase email may be required
                    to verify access.
                  </p>


                  <a
                    href="${downloadPage}"
                    target="_blank"
                    rel="noopener noreferrer"
                    style="
                      display:inline-block;
                      padding:14px 24px;
                      background:#c9a45c;
                      color:#111111;
                      text-decoration:none;
                      border-radius:7px;
                      font-size:13px;
                      font-weight:bold;
                      letter-spacing:0.7px;
                      text-transform:uppercase;
                    "
                  >
                    ACCESS MY BOOKS
                  </a>

                </div>


                <!-- Security note -->

                <div style="
                  margin-top:26px;
                  padding:18px;
                  background:#fafafa;
                  border-left:3px solid #c9a45c;
                ">

                  <p style="
                    margin:0;
                    font-size:13px;
                    line-height:1.7;
                    color:#666666;
                  ">
                    For security, this email does not
                    contain direct PDF download links.
                    Use the secure book-access page to
                    retrieve your purchased books.
                  </p>

                </div>


                <!-- Download information -->

                <p style="
                  margin:26px 0 0;
                  font-size:13px;
                  line-height:1.7;
                  color:#777777;
                ">
                  Download access is available for
                  30 days. Download limits may apply
                  to each purchased book.
                </p>

              </div>


              <!-- Footer -->

              <div style="
                padding:24px 36px;
                border-top:1px solid #eeeeee;
                background:#fafafa;
              ">

                <p style="
                  margin:0 0 6px;
                  font-size:12px;
                  color:#777777;
                ">
                  Business Playbook
                </p>

                <p style="
                  margin:0;
                  font-size:11px;
                  line-height:1.6;
                  color:#999999;
                ">
                  This is an automated purchase
                  confirmation email. Please do not
                  reply directly to this message.
                </p>

              </div>

            </div>

          </div>

        </body>

      </html>
    `,
  };


  /*
  |--------------------------------------------------------------------------
  | SEND EMAIL
  |--------------------------------------------------------------------------
  */

  await transporter.sendMail(
    mailOptions
  );


  console.log(
    `✅ Purchase confirmation email sent to ${email}`
  );
}


/*
|--------------------------------------------------------------------------
| EXPORT
|--------------------------------------------------------------------------
*/

module.exports = {
  sendPurchaseEmail,
};