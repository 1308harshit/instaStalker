// Test: SDK with PRODUCTION credentials
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const Paytm = require("paytm-pg-node-sdk");

const MID = "PExmXA65738094235544";
const KEY = "GQ_I&0vwOkr1lUHW";
const WEBSITE = "DEFAULT";

console.log("Using PRODUCTION SDK...");
console.log("MID:", MID);
console.log("KEY:", KEY, "(length:", KEY.length + ")");

// Initialize with PRODUCTION environment
const env = Paytm.LibraryConstants.PRODUCTION_ENVIRONMENT;
Paytm.MerchantProperties.setCallbackUrl("https://samjhona.com/api/payment/paytm-callback");
Paytm.MerchantProperties.initialize(env, MID, KEY, WEBSITE);

// Log the endpoint the SDK will use
console.log("SDK initiateTransaction URL:", Paytm.MerchantProperties.getInitiateTxnUrl());

const channelId = Paytm.EChannelId.WEB;
const orderId = "SDK_PROD_" + Date.now();
const txnAmount = Paytm.Money.constructWithCurrencyAndValue(Paytm.EnumCurrency.INR, "1.00");
const userInfo = new Paytm.UserInfo("CUST_001");
const paymentDetail = new Paytm.PaymentDetailBuilder(channelId, orderId, txnAmount, userInfo).build();

console.log("\nCalling SDK createTxnToken...");
try {
  const response = await Paytm.Payment.createTxnToken(paymentDetail);
  const resBody = response?.responseObject?.body;
  const ri = resBody?.resultInfo;
  const token = resBody?.txnToken;
  
  console.log("ResultInfo:", JSON.stringify(ri, null, 2));
  if (token) {
    console.log("txnToken:", token);
    console.log("\n*** SUCCESS! ***");
  } else {
    console.log("No txnToken");
    console.log("Full response:", JSON.stringify(response, null, 2));
  }
} catch (e) {
  console.error("Error:", e.message || e);
}

process.exit(0);
