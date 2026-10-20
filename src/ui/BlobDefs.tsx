/** Shared SVG defs: the #tp-blob clip path used by `.modal-body`. Render once per document. */
export function BlobDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="tp-blob" clipPathUnits="objectBoundingBox">
          <path d="M0.5,0.01 C0.8,0.005 0.975,0.06 0.99,0.3 C1.002,0.5 0.998,0.72 0.97,0.86 C0.935,0.985 0.76,0.997 0.5,0.995 C0.24,0.997 0.07,0.99 0.032,0.87 C0.002,0.75 -0.004,0.5 0.008,0.29 C0.024,0.06 0.2,0.015 0.5,0.01 Z" />
        </clipPath>
      </defs>
    </svg>
  )
}
