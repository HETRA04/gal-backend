// routes/users.js
const express = require('express')
const router  = express.Router()
const { requireAuth, requireInstructor, supabaseAdmin } = require('../middleware/auth')

// ── COMPLETE ONBOARDING ────────────────────────────────────
// Called after learner fills in their profile details
router.post('/onboarding', requireAuth, async (req, res) => {
  try {
    const { role, postcode, city, test_centre, transmission_pref, gender_pref, theory_test_passed,
            car_make_model, transmission, years_experience, bio, listings, test_centre_instr } = req.body

    // Update base profile
    await supabaseAdmin
      .from('profiles')
      .update({
        postcode:        postcode || null,
        city:            city || null,
        onboarding_done: true,
      })
      .eq('id', req.user.id)

    if (role === 'learner') {
      await supabaseAdmin
        .from('learner_profiles')
        .update({
          test_centre:         test_centre || null,
          transmission_pref:   transmission_pref || 'manual',
          gender_pref:         gender_pref || 'no_preference',
          theory_test_passed:  theory_test_passed || false,
        })
        .eq('user_id', req.user.id)
    }

    if (role === 'instructor') {
      const { data: ip } = await supabaseAdmin
        .from('instructor_profiles')
        .update({
          car_make_model:   car_make_model || null,
          transmission:     transmission || 'manual',
          years_experience: years_experience || 0,
          bio:              bio || null,
          test_centre:      test_centre_instr || null,
        })
        .eq('user_id', req.user.id)
        .select()
        .single()

      // Set listing types
      if (listings?.length && ip?.id) {
        // Get listing type IDs
        const { data: listingTypes } = await supabaseAdmin
          .from('listing_types')
          .select('id, name')
          .in('name', listings)

        if (listingTypes?.length) {
          await supabaseAdmin
            .from('instructor_listings')
            .delete()
            .eq('instructor_id', ip.id)

          await supabaseAdmin
            .from('instructor_listings')
            .insert(listingTypes.map(lt => ({
              instructor_id: ip.id,
              listing_id:    lt.id,
            })))
        }
      }
    }

    res.json({ success: true })
  } catch (err) {
    console.error('Onboarding error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── SUBMIT REVIEW ─────────────────────────────────────────
router.post('/reviews', requireAuth, async (req, res) => {
  try {
    const { instructor_id, booking_id, rating, comment } = req.body

    if (!instructor_id || !rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'instructor_id and rating (1-5) required' })
    }

    // Check user is learner for this booking
    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('learner_id, status')
      .eq('id', booking_id)
      .single()

    if (!booking || booking.learner_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorised to review this booking' })
    }
    if (booking.status !== 'completed') {
      return res.status(400).json({ error: 'Can only review completed lessons' })
    }

    const { data: review, error } = await supabaseAdmin
      .from('reviews')
      .insert({
        instructor_id,
        learner_id: req.user.id,
        booking_id,
        rating,
        comment: comment || null,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Already reviewed this booking' })
      throw error
    }

    res.json({ review })
  } catch (err) {
    console.error('Review error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── UPDATE INSTRUCTOR AVAILABILITY ────────────────────────
router.post('/availability', requireInstructor, async (req, res) => {
  try {
    const { slots } = req.body  // array of { start_time, end_time }
    if (!slots?.length) return res.status(400).json({ error: 'slots array required' })

    const { data: ip } = await supabaseAdmin
      .from('instructor_profiles')
      .select('id')
      .eq('user_id', req.user.id)
      .single()

    const { error } = await supabaseAdmin
      .from('availability_slots')
      .insert(slots.map(s => ({
        instructor_id: ip.id,
        start_time:    s.start_time,
        end_time:      s.end_time,
        is_recurring:  s.is_recurring || false,
        recur_days:    s.recur_days || null,
      })))

    if (error) throw error
    res.json({ success: true, count: slots.length })
  } catch (err) {
    console.error('Availability error:', err)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
