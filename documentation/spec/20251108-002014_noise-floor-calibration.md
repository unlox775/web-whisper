## Summary
- Investigate why the stored volume histograms exhibit step changes in their noise floor that do not match perceived loudness.

## ✅ Done
- Logged the latest observations about inconsistent baseline levels in the histogram despite steady background hum.

## 🚧 In Progress / Placeholders
- Evaluate the current RMS computation for susceptibility to out-of-band energy or decoder artifacts.
- Design a versioned volume-profile schema that can trigger regeneration when heuristics change.

## ⏭️ Next Actions / Dependencies
- Research perceptual weighting (e.g., A-weighting, phon weighting) or band-limited RMS as a better proxy for human hearing.
- Add smoothing/gating stages (median filters, attack/release envelopes) to stabilize the noise floor representation.
- Implement backwards-compatible migration that reprocesses cached profiles when the analyzer version increments.
