/**
 * Owner-approved 301 redirects (2026-11-21) for retired public URLs.
 *
 * Keep identical to retiredRoutes in 3d-frontend/scripts/retired-routes.mts,
 * which audits the live redirects after each release. Keys are exact clean
 * paths; their .html object forms are not redirected and must stay absent
 * (404). The lists are stored as slugs so the emitted CloudFront function
 * stays well under its 10 KB code limit.
 */

/** Root-level tool paths: /<slug> redirects to /tools/<slug>. */
export const legacyRootToolSlugs: readonly string[] = [
  '3d-print-bed-layout-planner',
  '3d-print-cost-calculator',
  '3d-print-finish-time-calculator',
  '3d-print-flow-rate-calculator',
  '3d-print-orientation-planner',
  '3d-print-shrinkage-calculator',
  '3d-print-tolerance-calculator',
  '3d-printer-fit-checker',
  '3d-printing-material-selector',
  '3d-printing-price-calculator',
  '3d-printing-quote-generator',
  '3mf-dimensions-checker',
  '3mf-manifold-checker',
  '3mf-overhang-checker',
  '3mf-print-preflight',
  '3mf-quality-checker',
  '3mf-repair',
  '3mf-to-stl-converter',
  '3mf-tools',
  '3mf-triangle-counter',
  '3mf-viewer',
  '3mf-volume-calculator',
  '3mf-wall-thickness-checker',
  '3mf-watertight-checker',
  'batch-stl-checker',
  'compare-3d-printers',
  'compare-3d-printing-materials',
  'filament-length-calculator',
  'filament-remaining-calculator',
  'gcode-preflight-checker',
  'nozzle-layer-height-calculator',
  'stl-compare',
  'stl-dimensions-checker',
  'stl-file-size-reducer',
  'stl-manifold-checker',
  'stl-overhang-checker',
  'stl-print-preflight',
  'stl-quality-checker',
  'stl-repair',
  'stl-scale-tool',
  'stl-splitter',
  'stl-to-3mf-converter',
  'stl-tools',
  'stl-triangle-counter',
  'stl-viewer',
  'stl-volume-calculator',
  'stl-wall-thickness-checker',
  'stl-watertight-checker',
  'volumetric-flow-calculator',
];

/** Root-level guide copies from before the /guides/ move on 2026-10-28: /<slug> redirects to /guides/<slug>. */
export const legacyRootGuideSlugs: readonly string[] = [
  '3d-print-batch-cost-per-part',
  '3d-print-bridge-vs-overhang',
  '3d-print-elephants-foot-and-part-fit',
  '3d-print-file-preflight-checklist',
  '3d-print-flow-rate-vs-e-steps',
  '3d-print-heat-set-insert-hole-sizing',
  '3d-print-hole-orientation-and-accuracy',
  '3d-print-hole-size-compensation',
  '3d-print-labour-cost-and-post-processing',
  '3d-print-lead-time-vs-print-time',
  '3d-print-overhangs-and-supports-guide',
  '3d-print-snap-fit-clearance',
  '3d-print-support-and-purge-material-cost',
  '3d-print-tolerance-and-clearance-guide',
  '3d-print-wall-thickness-guide',
  '3d-printer-calibration-guide',
  '3d-printing-quote-checklist',
  '3mf-missing-objects-after-import',
  '3mf-to-stl-combined-or-separate-parts',
  '3mf-to-stl-wrong-size-or-position',
  '3mf-units-explained',
  '3mf-vs-stl',
  'alignment-pins-for-split-3d-prints',
  'ascii-vs-binary-stl',
  'best-file-format-for-3d-printing',
  'brass-vs-hardened-nozzle',
  'can-you-use-gcode-from-another-printer',
  'check-stl-files-before-selling',
  'does-3mf-keep-colours-materials-and-settings',
  'extract-part-from-3mf',
  'filament-dryer-vs-dry-box',
  'floating-regions-in-slicer',
  'gcode-outside-print-bed',
  'gcode-preview-incomplete',
  'how-inspectmesh-checks-files',
  'how-many-metres-in-1kg-filament',
  'how-much-filament-does-a-3d-print-use',
  'how-much-to-charge-for-3d-prints',
  'how-to-arrange-multiple-parts-on-a-3d-printer-bed',
  'how-to-calculate-3d-printing-cost',
  'how-to-calculate-3mf-volume',
  'how-to-check-3mf-triangle-count',
  'how-to-check-3mf-wall-thickness-for-3d-printing',
  'how-to-check-a-3mf-file-for-errors',
  'how-to-check-gcode-before-printing',
  'how-to-check-if-a-3d-model-fits-your-printer',
  'how-to-check-if-a-3d-model-is-ready-to-print',
  'how-to-check-stl-for-errors',
  'how-to-check-stl-wall-thickness-for-3d-printing',
  'how-to-compare-stl-revisions',
  'how-to-compensate-for-3d-print-shrinkage',
  'how-to-convert-3mf-to-stl',
  'how-to-convert-stl-to-3mf',
  'how-to-estimate-filament-weight-from-a-3mf-file',
  'how-to-export-stl-from-cad',
  'how-to-fix-flipped-normals-in-an-stl-file',
  'how-to-fix-holes-in-an-stl-file',
  'how-to-fix-non-manifold-stl',
  'how-to-hollow-an-stl-file-for-3d-printing',
  'how-to-inspect-stl-3mf-cross-sections',
  'how-to-lay-an-stl-flat-on-print-bed',
  'how-to-make-an-stl-file-printable',
  'how-to-measure-3d-model',
  'how-to-open-a-3mf-file',
  'how-to-open-an-stl-file',
  'how-to-open-and-view-gcode-files',
  'how-to-orient-an-stl-file-for-3d-printing',
  'how-to-reduce-stl-file-size',
  'how-to-reduce-stl-triangle-count',
  'how-to-remove-duplicate-triangles-from-an-stl-file',
  'how-to-repair-a-3mf-file',
  'how-to-repair-an-stl-file',
  'how-to-rotate-a-3d-model-to-fit-your-printer',
  'how-to-scale-a-3mf-file',
  'how-to-scale-an-stl-file-for-3d-printing',
  'how-to-split-an-stl-file-for-3d-printing',
  'how-to-tell-if-a-3mf-file-is-manifold',
  'how-to-tell-if-a-3mf-file-is-watertight',
  'how-to-tell-if-an-stl-is-watertight',
  'inspect-customer-supplied-print-files',
  'internal-faces-in-stl',
  'maximum-volumetric-speed-explained',
  'self-intersecting-mesh-vs-non-manifold',
  'sequential-3d-printing-clearance',
  'slicer-fills-hole-in-stl',
  'stl-file-wont-slice',
  'stl-model-off-build-plate',
  'stl-multiple-shells-disconnected-parts',
  'stl-resolution-chord-height-explained',
  'stl-scale-factor-explained',
  'stl-split-failed',
  'stl-triangle-count-explained',
  'stl-volume-calculation-wrong',
  'stl-vs-obj-for-3d-printing',
  'stl-vs-step-for-3d-printing',
  'supports-inside-holes-and-channels',
  'what-is-an-stl-file',
  'what-is-non-manifold-geometry',
  'why-stl-files-have-no-units',
  'why-wont-my-3mf-file-slice',
  'zero-thickness-stl-surface',
];

/**
 * Renamed single pages: exact clean path to its current path. Unlike section
 * moves, nothing below the old path is redirected.
 */
export const legacyRenamedPaths: Readonly<Record<string, string>> = {
  // Guide renamed and moved to /guides/stl-file-wont-slice; the pre-rename
  // root object stayed live as a self-canonical duplicate.
  '/why-wont-my-stl-file-slice': '/guides/stl-file-wont-slice',
};

/** Renamed sections: the prefix itself and every path below it move to the new prefix. */
export const legacySectionRedirects: Readonly<Record<string, string>> = {
  '/3d-printing-materials': '/materials',
};

/** Resolves a clean legacy path to its current path, or undefined. */
export function legacyRedirectTarget(path: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(legacyRenamedPaths, path)) {
    return legacyRenamedPaths[path];
  }
  const slug = path.slice(1);
  if (legacyRootToolSlugs.includes(slug)) {
    return '/tools/' + slug;
  }
  if (legacyRootGuideSlugs.includes(slug)) {
    return '/guides/' + slug;
  }
  if (path.includes('.')) {
    return undefined;
  }
  for (const [from, to] of Object.entries(legacySectionRedirects)) {
    if (path === from || path.startsWith(from + '/')) {
      return to + path.slice(from.length);
    }
  }
  return undefined;
}
