/**
 * The camera-torch constraint (Media Capture Image Capture spec, Chrome on
 * Android) is not yet in the standard TS DOM lib; augment the constraint set
 * so `track.applyConstraints({ advanced: [{ torch }] })` type-checks.
 */
interface MediaTrackConstraintSet {
  torch?: ConstrainBoolean;
}
