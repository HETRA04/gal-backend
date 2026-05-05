// routes/stripe.js
const express = require('express')
const router  = express.Router()
const Stripe  = require('stripe')
const { requireAuth, requireInstructor, supabaseAdmin } = require('../middleware/auth')

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// ── CREATE CHECKOUT SESSION ─────────────────────────────────
// Called when an instructor registers or wants to activate subscription
router.post('/checkout', requireAuth, async (req, res) => {
  try {
    const { email } = req.body
    const userId = req.user.id

    // Get or create Stripe customer
    const { data: instrProfile } = await supabaseAdmin
      .from('instructor_profiles')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single()

    let customerId = instrProfile?.stripe_customer_id

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: email || req.user.email,
        metadata: { supabase_user_id: userId },
      })
      customerId = customer.id
      // Save customer ID
      await supabaseAdmin
        .from('instructor_profiles')
        .update({ stripe_customer_id: customerId })
        .eq('user_id', userId)
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer:             customerId,
      payment_method_types: ['card'],
      line_items: [{
        price:    process.env.STRIPE_INSTRUCTOR_PRICE_ID,
        quantity: 1,
      }],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL}/instructor.html?subscription=success`,
      cancel_url:  `${process.env.FRONTEND_URL}/instructor.html?subscription=cancelled`,
      metadata: { supabase_user_id: userId },
    })

    res.json({ url: session.url })
  } catch (err) {
    console.error('Stripe checkout error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── BILLING PORTAL ──────────────────────────────────────────
// Lets instructors manage/cancel their subscription
router.post('/portal', requireInstructor, async (req, res) => {
  try {
    const { data: instrProfile } = await supabaseAdmin
      .from('instructor_profiles')
      .select('stripe_customer_id')
      .eq('user_id', req.user.id)
      .single()

    if (!instrProfile?.stripe_customer_id) {
      return res.status(400).json({ error: 'No Stripe customer found' })
    }

    const session = await stripe.billingPortal.sessions.create({
      customer:   instrProfile.stripe_customer_id,
      return_url: `${process.env.FRONTEND_URL}/instructor.html`,
    })

    res.json({ url: session.url })
  } catch (err) {
    console.error('Stripe portal error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── WEBHOOK ─────────────────────────────────────────────────
// Stripe calls this when subscription status changes
// Raw body parsing is set up in index.js before this route
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature']

  let event
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('Webhook signature failed:', err.message)
    return res.status(400).json({ error: `Webhook Error: ${err.message}` })
  }

  console.log('Stripe webhook:', event.type)

  switch (event.type) {

    // Subscription created or renewed — activate instructor
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub       = event.data.object
      const customerId = sub.customer
      const status    = sub.status // active, trialing, past_due, cancelled etc.

      await supabaseAdmin
        .from('instructor_profiles')
        .update({
          stripe_subscription_id: sub.id,
          subscription_status:    status,
          subscription_ends_at:   new Date(sub.current_period_end * 1000).toISOString(),
        })
        .eq('stripe_customer_id', customerId)

      console.log(`Instructor subscription ${status} for customer ${customerId}`)
      break
    }

    // Subscription cancelled
    case 'customer.subscription.deleted': {
      const sub = event.data.object
      await supabaseAdmin
        .from('instructor_profiles')
        .update({ subscription_status: 'cancelled', stripe_subscription_id: null })
        .eq('stripe_customer_id', sub.customer)
      console.log(`Subscription cancelled for customer ${sub.customer}`)
      break
    }

    // Payment failed
    case 'invoice.payment_failed': {
      const inv = event.data.object
      await supabaseAdmin
        .from('instructor_profiles')
        .update({ subscription_status: 'past_due' })
        .eq('stripe_customer_id', inv.customer)
      console.log(`Payment failed for customer ${inv.customer}`)
      break
    }

    // Checkout completed — mark onboarding done
    case 'checkout.session.completed': {
      const session = event.data.object
      const userId  = session.metadata?.supabase_user_id
      if (userId) {
        await supabaseAdmin
          .from('profiles')
          .update({ onboarding_done: true })
          .eq('id', userId)
        console.log(`Onboarding complete for user ${userId}`)
      }
      break
    }

    default:
      console.log(`Unhandled event: ${event.type}`)
  }

  res.json({ received: true })
})

module.exports = router
