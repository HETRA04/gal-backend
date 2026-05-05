// middleware/auth.js
const { createClient } = require('@supabase/supabase-js')

// Admin client with service key — bypasses RLS for server-side operations
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// Verify the JWT sent by the frontend
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' })
  }

  const token = authHeader.replace('Bearer ', '')

  // Verify token with Supabase using service key
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  // Attach user and admin client to request
  req.user          = user
  req.supabaseAdmin = supabaseAdmin
  next()
}

// Verify user is an instructor
async function requireInstructor(req, res, next) {
  await requireAuth(req, res, async () => {
    const { data: profile } = await req.supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single()

    if (!profile || !['instructor', 'enterprise'].includes(profile.role)) {
      return res.status(403).json({ error: 'Instructor access required' })
    }
    next()
  })
}

// Verify user is a learner
async function requireLearner(req, res, next) {
  await requireAuth(req, res, async () => {
    const { data: profile } = await req.supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single()

    if (!profile || profile.role !== 'learner') {
      return res.status(403).json({ error: 'Learner access required' })
    }
    next()
  })
}

module.exports = { requireAuth, requireInstructor, requireLearner, supabaseAdmin }
