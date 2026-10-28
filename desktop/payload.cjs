// Explicit allowlist: never ship local databases, histories, media, models or environments.
module.exports = [
  'aspect_profiles.py', 'batch_exports.py', 'caption_runtime.py', 'caption_worker.py',
  'captions.py', 'duration_profiles.py', 'editing_worker.py', 'editing.py', 'forced_alignment.py',
  'library.py', 'quality_profiles.py', 'server.py', 'social_exports.py', 'studio_paths.py',
  'waveforms.py', 'workflow_runner.py', 'workspace.py',
  'workspace.html', 'classic.html', 'workspace.js', 'workspace.css', 'app.js', 'ui.js',
  'runner.js', 'style.css', 'social-export.js', 'social-export.css', 'editing.js', 'editing.css',
  'caption-ui.js', 'caption-alignment.js', 'caption-phrase-model.js', 'caption-phrases.js',
  'caption-readability-model.js', 'caption-readability.js', 'caption-fix-model.js', 'caption-fixes.js',
  'caption-timeline-model.js', 'caption-timeline.js', 'caption-waveform.js', 'batch-export.js', 'batch-export.css',
  ...['animal','background','control','edit','flux3','image','inpaint','interpolate','ltx','ltxlegacy',
    'motion','reference','sdxl','talk','upscale','vace','video','wan14'].map(name => `tests/render-prompts/${name}.json`)
];
