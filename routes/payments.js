// ─────────────────────────────────────────────
// YOU-HAVE-VALUE — Payment Routes
// POST /api/payments/create-checkout-session
// POST /api/payments/webhook
// GET  /api/payments/subscription
// ─────────────────────────────────────────────

const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { protect } = require('../middleware/auth');
const { query } = require('../config/database');

// ══════════════════════════════════════════════
// POST /api/payments/create-checkout-session
// Creates a Stripe Checkout session
// User gets redirected to Stripe payment page
// ══════════════════════════════════════════════
router.post('/create-checkout-session', protect, async (req, res) => {
  try {
    const { priceId, planName, successUrl, cancelUrl } = req.body;

    if (!priceId) {
      return res.status(400).json({ success: false, message: 'Price ID is required.' });
    }

    // Get user email from database
    const userResult = await query(
      'SELECT id, email, full_name FROM users WHERE id = $1',
      [req.user.id]
    );

    if (!userResult.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const user = userResult.rows[0];

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: user.email,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl || process.env.FRONTEND_URL + '?payment=success',
      cancel_url: cancelUrl || process.env.FRONTEND_URL + '?payment=cancelled',
      metadata: {
        userId: req.user.id,
        planName: planName || 'Pro Plan',
      },
    });

    res.json({ success: true, url: session.url, sessionId: session.id });

  } catch (error) {
    console.error('Checkout session error:', error);
    res.status(500).json({ success: false, message: 'Failed to create checkout session.' });
  }
});


// ══════════════════════════════════════════════
// GET /api/payments/subscription
// Gets current user subscription status
// ══════════════════════════════════════════════
router.get('/subscription', protect, async (req, res) => {
  try {
    const result = await query(
      'SELECT subscription_plan, subscription_status, subscription_end FROM users WHERE id = $1',
      [req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const user = result.rows[0];
    res.json({
      success: true,
      subscription: {
        plan: user.subscription_plan || 'free',
        status: user.subscription_status || 'inactive',
        endDate: user.subscription_end || null,
      }
    });

  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({ success: false, message: 'Failed to get subscription.' });
  }
});


// ══════════════════════════════════════════════
// POST /api/payments/webhook
// Stripe calls this when payment is completed
// Updates user subscription in database
// ══════════════════════════════════════════════
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Verify webhook came from Stripe
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      event = JSON.parse(req.body);
    }
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed.' });
  }

  // Handle different webhook events
  switch (event.type) {

    // Payment succeeded - activate subscription
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const planName = session.metadata?.planName || 'Pro';

      if (userId) {
        try {
          // Determine plan level from plan name
          let planLevel = 'collaborator';
          if (planName.toLowerCase().includes('founder')) planLevel = 'founder';
          if (planName.toLowerCase().includes('investor')) planLevel = 'investor';

          // Update user subscription in database
          await query(
            `UPDATE users SET
               subscription_plan = $1,
               subscription_status = 'active',
               stripe_customer_id = $2,
               stripe_session_id = $3,
               subscription_start = NOW(),
               subscription_end = NOW() + INTERVAL '30 days'
             WHERE id = $4`,
            [planLevel, session.customer, session.id, userId]
          );

          console.log('Subscription activated for user:', userId, 'plan:', planLevel);
        } catch (dbError) {
          console.error('Database update error:', dbError);
        }
      }
      break;
    }

    // Subscription renewed
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      const customerId = invoice.customer;

      try {
        await query(
          `UPDATE users SET
             subscription_status = 'active',
             subscription_end = NOW() + INTERVAL '30 days'
           WHERE stripe_customer_id = $1`,
          [customerId]
        );
        console.log('Subscription renewed for customer:', customerId);
      } catch (dbError) {
        console.error('Renewal update error:', dbError);
      }
      break;
    }

    // Subscription cancelled or payment failed
    case 'customer.subscription.deleted':
    case 'invoice.payment_failed': {
      const obj = event.data.object;
      const customerId = obj.customer;

      try {
        await query(
          `UPDATE users SET
             subscription_status = 'inactive',
             subscription_plan = 'free'
           WHERE stripe_customer_id = $1`,
          [customerId]
        );
        console.log('Subscription cancelled for customer:', customerId);
      } catch (dbError) {
        console.error('Cancellation update error:', dbError);
      }
      break;
    }

    default:
      console.log('Unhandled webhook event:', event.type);
  }

  // Always respond 200 to Stripe
  res.json({ received: true });
});

module.exports = router;
