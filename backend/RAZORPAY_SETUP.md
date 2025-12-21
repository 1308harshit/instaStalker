# Razorpay Payment Gateway Integration

This backend API provides endpoints for processing payments through Razorpay.

## Setup Instructions

1. **Install Dependencies**
   ```bash
   cd backend
   npm install
   ```

2. **Configure Environment Variables**
   - Create a `.env` file in the `backend` directory
   - Add your Razorpay credentials:
     ```
     RAZORPAY_KEY_ID=your_razorpay_key_id
     RAZORPAY_KEY_SECRET=your_razorpay_key_secret
     PORT=3000
     ```

3. **Get Razorpay Credentials**
   - Sign up at [Razorpay Dashboard](https://dashboard.razorpay.com/)
   - Go to Settings > API Keys
   - Generate Test/Live API keys
   - Copy Key ID and Key Secret to your `.env` file

4. **Start the Server**
   ```bash
   npm start
   ```

## API Endpoints

### 1. Create Order
**POST** `/api/payment/create-order`

Creates a new Razorpay order.

**Request Body:**
```json
{
  "amount": 1000,
  "currency": "INR",
  "receipt": "receipt_123",
  "notes": {
    "customer_name": "John Doe",
    "order_id": "order_123"
  },
  "email": "[email protected]",
  "fullName": "John Doe",
  "phoneNumber": "9999999999"
}
```

**Response:**
```json
{
  "success": true,
  "orderId": "order_abc123",
  "amount": 100000,
  "currency": "INR",
  "key": "your_razorpay_key_id",
  "receipt": "receipt_123"
}
```

### 2. Verify Payment
**POST** `/api/payment/verify-payment`

Verifies the payment signature after successful payment.

**Request Body:**
```json
{
  "orderId": "order_abc123",
  "paymentId": "pay_xyz789",
  "signature": "signature_hash"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Payment verified successfully",
  "orderId": "order_abc123",
  "paymentId": "pay_xyz789"
}
```

### 3. Get Payment Details
**GET** `/api/payment/payment/:paymentId`

Fetches payment details by payment ID.

**Response:**
```json
{
  "success": true,
  "payment": {
    "id": "pay_xyz789",
    "amount": 100000,
    "currency": "INR",
    "status": "captured",
    ...
  }
}
```

### 4. Get Order Details
**GET** `/api/payment/order/:orderId`

Fetches order details by order ID.

**Response:**
```json
{
  "success": true,
  "order": {
    "id": "order_abc123",
    "amount": 100000,
    "currency": "INR",
    "status": "paid",
    ...
  }
}
```

### 5. Save User Data
**POST** `/api/payment/save-user`

Saves user information to MongoDB before payment.

**Request Body:**
```json
{
  "email": "[email protected]",
  "fullName": "John Doe",
  "phoneNumber": "9999999999"
}
```

## Frontend Integration

The frontend HTML has been updated to use Razorpay Checkout. Here's how to integrate it in your frontend code:

```javascript
// Step 1: Create order on backend
async function createOrder(amount, email, fullName, phoneNumber) {
  const response = await fetch('/api/payment/create-order', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: amount,
      currency: 'INR',
      email: email,
      fullName: fullName,
      phoneNumber: phoneNumber,
    }),
  });
  
  const data = await response.json();
  return data;
}

// Step 2: Initialize Razorpay checkout
async function initiatePayment(amount, email, fullName, phoneNumber) {
  try {
    // Create order
    const order = await createOrder(amount, email, fullName, phoneNumber);
    
    // Initialize Razorpay checkout
    const options = {
      key: order.key, // Razorpay Key ID from backend
      amount: order.amount, // Amount in paise
      currency: order.currency,
      name: 'Your Company Name',
      description: 'Payment for your service',
      order_id: order.orderId, // Order ID from backend
      handler: function (response) {
        // Handle successful payment
        verifyPayment(response);
      },
      prefill: {
        name: fullName,
        email: email,
        contact: phoneNumber
      },
      theme: {
        color: '#3399cc'
      },
      modal: {
        ondismiss: function() {
          console.log('Payment cancelled');
        }
      }
    };

    const razorpay = new Razorpay(options);
    razorpay.open();
  } catch (error) {
    console.error('Error initiating payment:', error);
  }
}

// Step 3: Verify payment on backend
async function verifyPayment(response) {
  try {
    const result = await fetch('/api/payment/verify-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        orderId: response.razorpay_order_id,
        paymentId: response.razorpay_payment_id,
        signature: response.razorpay_signature,
      }),
    });
    
    const data = await result.json();
    if (data.success) {
      // Payment verified successfully
      console.log('Payment verified!', data);
      // Redirect to success page or show success message
    } else {
      console.error('Payment verification failed:', data.error);
    }
  } catch (error) {
    console.error('Error verifying payment:', error);
  }
}
```

## Important Notes

- **Amount**: Razorpay expects amount in paise (smallest currency unit). The backend automatically converts rupees to paise (multiplies by 100).
- **Signature Verification**: Always verify payment signatures on the backend for security.
- **Never expose** your `RAZORPAY_KEY_SECRET` in frontend code.
- Use HTTPS in production.
- Store sensitive credentials in environment variables only.

## Testing

Use Razorpay's test credentials for development:
- Test Key ID and Key Secret are available in Razorpay Dashboard (Test Mode)
- Use test card numbers provided in Razorpay documentation

## Security Best Practices

1. Always verify payment signatures on the backend
2. Never store or log full secret keys
3. Use environment variables for all sensitive data
4. Enable webhook verification for production
5. Implement proper error handling and logging
