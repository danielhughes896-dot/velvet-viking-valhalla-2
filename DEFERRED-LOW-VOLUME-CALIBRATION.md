# DEFERRED — LOW-VOLUME EARLY CALIBRATION

Recorded, not implemented. HQ opens this as the next SYSTEM methodology task
immediately after the plan-mathematics branch merges.

## The issue

Threshold Calibration is a FIXED protocol and does not scale to the athlete:

    warm-up 12 min + settle 10 min + measured 20 min + cool-down 10 min = 52 min
    of which 30 minutes are ONE CONTINUOUS effort at threshold
    calibrationSessionKm() = 9.5 km, priced the way the app prices any timed
    prescription

Measured against the athlete it would be given to
(`node test/audit/calibrationCost.js`):

    weekly volume        share of the week     share of their longest OTHER run
    14 km/week                 51%                        317%
    20 km/week (the floor)     42%                        238%
    30 km/week                 30%                        136%
    40 km/week                 22%                         95%

At `CALIBRATION_MIN_WEEKLY_KM` the session is already the longest run of the
athlete's week and more than two-fifths of it. The floor is not conservative;
it is close to the minimum at which this protocol is expressible at all.

## What that task may not start by assuming

    CALIBRATION_MIN_WEEKLY_KM = 20    not lowered, waived or worked around
    the 52-minute protocol            unchanged
    calibrationSessionKm() = 9.5km    the honest costing, declared as a
                                      quality-day floor where it exceeds the
                                      week's tempo allocation
    the TEST/CALIBRATION class        unchanged
    lthr_known / recent_measured_effort / no_health_consent
                                      unchanged refusals

## The question

A genuinely sub-20 km/week athlete cannot supply threshold evidence early,
because the only instrument the product has costs more than their whole week.
Whether a lower-cost valid early assessment exists — what it would measure, at
what confidence, and whether that confidence is enough to prescribe from — is a
methodology question, not an implementation one.

It was explicitly NOT designed during the closure pass. No replacement protocol
has been proposed, sketched or reserved anywhere in the code.
