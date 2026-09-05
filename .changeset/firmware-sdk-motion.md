---
"stack-chan": minor
---

Add opt-in V2 app motion with explicit degree and millisecond units, bounded trajectories, measured or estimated completion, cancellation that drains pending driver work, and foreground moves that temporarily take priority over gaze. App shutdown waits for motion cleanup while the host retains physical device ownership.

Expose motion availability and calibrated limits, including unavailable servo power and estimated PWM or simulator feedback. Coordinate DYNAMIXEL's internal control loop with managed operations and suppress torque reactivation from revoked operations. Correct SCServo's readback center and report unclamped M5StackChan measurements; physical calibration and motion acceptance remain required.

Connect simulator motion through the private browser driver bridge, supply the elapsed clock missing from Moddable 9.5's WASM Time.ticks, and add a fifth JavaScript lesson and browser acceptance coverage.
