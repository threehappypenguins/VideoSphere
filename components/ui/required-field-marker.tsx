/**
 * Visual asterisk indicating a form field is required.
 * Pair with `required` or `aria-required="true"` on the associated input;
 * the marker is aria-hidden so screen readers use the native required semantics.
 * @returns A styled asterisk for required field labels.
 */
export function RequiredFieldMarker() {
  return (
    <span className="text-destructive" aria-hidden="true">
      {' '}
      *
    </span>
  );
}
