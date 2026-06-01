// routes/notifications.js
const express = require('express')
const router  = express.Router()
const { requireAuth, supabaseAdmin } = require('../middleware/auth')

const ONESIGNAL_APP_ID = 'd3cc5490-9f95-4ae9-8308-092265465519'

async function sendPush(userId, title, body, data = {}) {
  const apiKey = process.env.ONESIGNAL_API_KEY
  if (!apiKey) return // silently skip if not configured
  await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Key ${apiKey}`,
    },
    body: JSON.stringify({
      app_id:           ONESIGNAL_APP_ID,
      include_aliases:  { external_id: [userId] },
      target_channel:   'push',
      headings:         { en: title },
      contents:         { en: body },
      data,
    }),
  }).catch(e => console.error('OneSignal push error:', e.message))
}

// Internal helper exported for use in bookings routes
router.sendPush = sendPush

// POST /notifications/send  (admin/server use)
router.post('/send', requireAuth, async (req, res) => {
  try {
    const { userId, title, body, data } = req.body
    if (!userId || !title || !body) return res.status(400).json({ error: 'userId, title, body required' })
    await sendPush(userId, title, body, data)
    res.json({ success: true })
  } catch (err) {
    console.error('Send notification error:', err)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
