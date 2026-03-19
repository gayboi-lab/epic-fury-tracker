const express = require("express");
const cors = require("cors");
const path = require("path");
const Stripe = require("stripe");

const app = express();
const PORT = process.env.PORT || 10000;

let stripe;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2025-02-24.acacia",
  });
} else {
  console.warn("WARNING: STRIPE_SECRET_KEY not set. Payment endpoints will not work.");
}

const PRICE_AMOUNT = 159; // $1.59 in cents
const PRODUCT_NAME = "Operation Epic Fury Tracker — Premium";

// Track completed payments in memory
const completedPayments = new Set();

// CORS - allow requests from the frontend
app.use(cors({
  origin: [
    "https://www.perplexity.ai",
    "https://perplexity.ai",
    "https://sites.pplx.app",
    /\.pplx\.app$/,
    /localhost/,
  ],
  credentials: true,
}));

// Parse JSON (except for webhook which needs raw body)
app.use((req, res, next) => {
  if (req.path === "/api/stripe-webhook") {
    express.raw({ type: "application/json" })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});

// Serve static frontend
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Create a Stripe Checkout session
app.post("/api/create-checkout-session", async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Payment service not configured" });
  try {
    const { successUrl, cancelUrl } = req.body;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: PRODUCT_NAME,
              description:
                "Lifetime premium access: ad-free, data exports, intelligence analysis, push notifications.",
            },
            unit_amount: PRICE_AMOUNT,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: successUrl || `${req.headers.origin || 'https://epic-fury-tracker.onrender.com'}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${req.headers.origin || 'https://epic-fury-tracker.onrender.com'}`,
    });

    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error("Stripe checkout error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Verify a completed checkout session
app.get("/api/verify-payment/:sessionId", async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "Payment service not configured" });
  try {
    const session = await stripe.checkout.sessions.retrieve(
      req.params.sessionId
    );

    if (session.payment_status === "paid") {
      completedPayments.add(session.id);
      res.json({ paid: true, customerEmail: session.customer_details?.email });
    } else {
      res.json({ paid: false });
    }
  } catch (error) {
    console.error("Payment verification error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Stripe webhook for payment events
app.post("/api/stripe-webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    res.json({ received: true });
    return;
  }

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      completedPayments.add(session.id);
      console.log(`Payment completed: ${session.id}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error.message);
    res.status(400).json({ error: error.message });
  }
});

// Catch-all: serve index.html for any non-API route (SPA support)
app.get("*", (req, res) => {
  if (!req.path.startsWith("/api")) {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Epic Fury Tracker running on port ${PORT}`);

  // Self-ping every 14 minutes to prevent Render free tier from sleeping
  const RENDER_URL = "https://epic-fury-tracker.onrender.com";
  const PING_INTERVAL = 14 * 60 * 1000; // 14 minutes

  setInterval(async () => {
    try {
      const res = await fetch(`${RENDER_URL}/api/health`);
      const data = await res.json();
      console.log(`[keep-alive] pinged at ${new Date().toISOString()} - ${data.status}`);
    } catch (err) {
      console.error(`[keep-alive] ping failed: ${err.message}`);
    }
  }, PING_INTERVAL);

  console.log(`[keep-alive] self-ping enabled every 14 minutes`);
});
