// Test 4: SDK with monkey-patched URL (what worked before)
// Test 5: Old-style form POST to /order/process

import { createRequire } from "module";
const require = createRequire(import.meta.url);

const Paytm = require("paytm-pg-node-sdk");
const PaytmChecksum = require("paytmchecksum");
const axios = require("axios");
const https = require("https");

const MID = "SCINKF38676225955152";
const KEY = "Q22WldyyCskNM&%&";
const WEBSITE = "WEBSTAGING";

// ===== TEST 4: SDK with monkey-patched URL =====
console.log("\n=== TEST 4: SDK with monkey-patched URL ===");
try {
  const env = Paytm.LibraryConstants.STAGING_ENVIRONMENT;
  Paytm.MerchantProperties.setCallbackUrl("https://securegw-stage.paytm.in/theia/paytmCallback?ORDER_ID=TEST4");
  Paytm.MerchantProperties.initialize(env, MID, KEY, WEBSITE);

  // Monkey-patch: override the initiateTransaction URL
  Paytm.MerchantProperties.getInitiateTxnUrl = () =>
    "https://securegw-stage.paytm.in/theia/api/v1/initiateTransaction";

  const channelId = Paytm.EChannelId.WEB;
  const orderId4 = "TEST4_" + Date.now();
  const txnAmount = Paytm.Money.constructWithCurrencyAndValue(Paytm.EnumCurrency.INR, "1.00");
  const userInfo = new Paytm.UserInfo("CUST_001");
  const paymentDetail = new Paytm.PaymentDetailBuilder(channelId, orderId4, txnAmount, userInfo).build();

  console.log("Calling SDK createTxnToken with patched URL...");
  const response = await Paytm.Payment.createTxnToken(paymentDetail);
  console.log("Result:", JSON.stringify(response, null, 2));
} catch (e) {
  console.error("SDK Patched Error:", e.message || e);
}

// ===== TEST 5: Old-style checksum + form params (processTransaction flow) =====
console.log("\n=== TEST 5: Old-style processTransaction approach ===");
try {
  const orderId5 = "TEST5_" + Date.now();
  const params = {
    MID: MID,
    WEBSITE: WEBSITE,
    CHANNEL_ID: "WEB",
    INDUSTRY_TYPE_ID: "Retail",
    ORDER_ID: orderId5,
    CUST_ID: "CUST_001",
    TXN_AMOUNT: "1.00",
    CALLBACK_URL: "http://localhost:5173/api/payment/paytm-callback",
  };

  // Old-style checksum: pass OBJECT (not JSON string)
  const checksum = await PaytmChecksum.generateSignature(params, KEY);
  console.log("Checksum:", checksum);
  console.log("Params:", JSON.stringify(params, null, 2));

  // Simulate form POST with URL-encoded body
  const formData = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    formData.append(k, v);
  }
  formData.append("CHECKSUMHASH", checksum);

  const url5 = "https://securegw-stage.paytm.in/order/process";
  console.log("POST", url5);
  console.log("Form body:", formData.toString().substring(0, 200), "...");

  const { data: data5, status: status5, headers: headers5 } = await axios.post(url5, formData.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15000,
    maxRedirects: 0,
    validateStatus: () => true,
  });

  console.log("Status:", status5);
  console.log("Response headers:", JSON.stringify(headers5, null, 2));
  if (typeof data5 === "string") {
    console.log("Response (first 500 chars):", data5.substring(0, 500));
  } else {
    console.log("Response:", JSON.stringify(data5, null, 2));
  }
} catch (e) {
  if (e.response) {
    console.error("HTTP Error:", e.response.status, typeof e.response.data === "string" ? e.response.data.substring(0, 300) : JSON.stringify(e.response.data));
  } else {
    console.error("Error:", e.message);
  }
}

process.exit(0);
