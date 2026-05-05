// routes/bookings.js
const express = require('express')
const router  = express.Router()
const { requireAuth, requireLearner, requireInstructor, supabaseAdmin } = require('../middleware/auth')

// ── CREATE BOOKING ─────────────────────────────────────────
router.post('/', requireLearner, async (req, res) => {
  try {
    const { instructor_id, slot_id, listing_id, scheduled_at, duration_mins, notes } = req.body

    if (!instructor_id || !scheduled_at) {
      return res.status(400).json({ error: 'instructor_id and scheduled_at are required' })
    }

    // Check instructor has active subscription
    const { data: instr } = await supabaseAdmin
      .from('instructor_profiles')
      .select('id, hourly_rate, subscription_status, is_accepting_students')
      .eq('id', instructor_id)
      .single()

    if (!instr) return res.status(404).json({ error: 'Instructor not found' })
    if (instr.subscription_status !== 'active') {
      return res.status(400).json({ error: 'Instructor is not currently accepting bookings' })
    }
    if (!instr.is_accepting_students) {
      return res.status(400).json({ error: 'Instructor is not accepting new students' })
    }

    // Check slot isn't already booked
    if (slot_id) {
      const { data: slot } = await supabaseAdmin
        .from('availability_slots')
        .select('is_booked')
        .eq('id', slot_id)
        .single()
      if (slot?.is_booked) {
        return res.status(409).json({ error: 'This slot is already booked' })
      }
    }

    // Calculate price
    const mins  = duration_mins || 60
    const price = (instr.hourly_rate * mins / 60).toFixed(2)

    // Create booking
    const { data: booking, error } = await supabaseAdmin
      .from('bookings')
      .insert({
        learner_id:    req.user.id,
        instructor_id: instr.id,
        slot_id:       slot_id || null,
        listing_id:    listing_id || null,
        scheduled_at,
        duration_mins: mins,
        price,
        notes:         notes || null,
        status:        'pending',
      })
      .select()
      .single()

    if (error) throw error

    // Create notification for instructor
    await supabaseAdmin.from('notifications').insert({
      user_id: (await supabaseAdmin.from('instructor_profiles').select('user_id').eq('id',instr.id).single()).data?.user_id,
      type:    'booking_confirmed',
      title:   'New booking request',
      body:    `You have a new lesson booking request`,
      data:    { booking_id: booking.id },
    })

    res.json({ booking })
  } catch (err) {
    console.error('Create booking error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── CANCEL BOOKING ─────────────────────────────────────────
router.patch('/:id/cancel', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const { reason } = req.body

    // Verify user is party to this booking
    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('learner_id, instructor_id, status, scheduled_at')
      .eq('id', id)
      .single()

    if (!booking) return res.status(404).json({ error: 'Booking not found' })

    // Get instructor user_id
    const { data: ip } = await supabaseAdmin
      .from('instructor_profiles')
      .select('user_id')
      .eq('id', booking.instructor_id)
      .single()

    if (booking.learner_id !== req.user.id && ip?.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorised to cancel this booking' })
    }

    if (['cancelled','completed'].includes(booking.status)) {
      return res.status(400).json({ error: `Booking is already ${booking.status}` })
    }

    const { data: updated, error } = await supabaseAdmin
      .from('bookings')
      .update({
        status:        'cancelled',
        cancelled_at:  new Date().toISOString(),
        cancelled_by:  req.user.id,
        cancel_reason: reason || null,
      })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    res.json({ booking: updated })
  } catch (err) {
    console.error('Cancel booking error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── COMPLETE LESSON ────────────────────────────────────────
router.patch('/:id/complete', requireInstructor, async (req, res) => {
  try {
    const { id } = req.params
    const { notes, passed_test } = req.body

    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('instructor_id, learner_id')
      .eq('id', id)
      .single()

    if (!booking) return res.status(404).json({ error: 'Booking not found' })

    // Verify instructor owns this booking
    const { data: ip } = await supabaseAdmin
      .from('instructor_profiles')
      .select('id')
      .eq('user_id', req.user.id)
      .single()

    if (booking.instructor_id !== ip?.id) {
      return res.status(403).json({ error: 'Not your booking' })
    }

    // Update booking status
    await supabaseAdmin.from('bookings').update({ status: 'completed' }).eq('id', id)

    // Update lesson record
    await supabaseAdmin.from('lessons').update({
      status:             'completed',
      completed_at:       new Date().toISOString(),
      instructor_notes:   notes || null,
      learner_passed_test: passed_test || false,
    }).eq('booking_id', id)

    // If passed — send review request notification to learner
    if (passed_test) {
      await supabaseAdmin.from('notifications').insert({
        user_id: booking.learner_id,
        type:    'review_request',
        title:   'How was your lesson?',
        body:    'Please leave a review for your instructor',
        data:    { booking_id: id },
      })
    } else {
      // Check if learner has had 10 lessons — auto trigger review request
      const { count } = await supabaseAdmin
        .from('lessons')
        .select('id', { count: 'exact', head: true })
        .eq('learner_id', booking.learner_id)
        .eq('instructor_id', booking.instructor_id)
        .eq('status', 'completed')

      if (count && count % 10 === 0) {
        await supabaseAdmin.from('notifications').insert({
          user_id: booking.learner_id,
          type:    'review_request',
          title:   `You've had ${count} lessons!`,
          body:    'How is your instructor doing? Leave a review',
          data:    { booking_id: id },
        })
      }
    }

    res.json({ success: true })
  } catch (err) {
    console.error('Complete lesson error:', err)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
