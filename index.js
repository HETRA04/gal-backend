// index.js — Railway entry point
// No dotenv needed — Railway injects env vars directly
const express = require('express')
const cors    = require('cors')
const app     = express()

// ── CORS ────────────────────────────────────────────────────
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    'https://getalesson.co.uk',
    'https://www.getalesson.co.uk',
    'capacitor://localhost',
    'http://localhost',
    'https://unrivaled-lolly-1224e1.netlify.app',
    'http://localhost:3000',
    'http://127.0.0.1:5500',
  ].filter(Boolean),
  credentials: true,
}))

// Raw body for Stripe webhooks MUST come before express.json()
app.use('/stripe/webhook', express.raw({ type: 'application/json' }))

// JSON for everything else
app.use(express.json())

// ── HEALTH CHECK ────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }))

// ── ROUTES ──────────────────────────────────────────────────
app.use('/stripe',        require('./routes/stripe'))
app.use('/bookings',      require('./routes/bookings'))
app.use('/users',         require('./routes/users'))
app.use('/notifications', require('./routes/notifications'))

// ── 404 ─────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }))

// ── ERROR HANDLER ───────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ error: err.message || 'Internal server error' })
})

const PORT = process.env.PORT || 4000
app.listen(PORT, () => console.log(`GAL backend running on port ${PORT}`))
