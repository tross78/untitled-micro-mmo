# Asset Pipeline

PNG files in `assets/source/` are authoring inputs only.

The runtime does not load PNGs directly. Instead:

1. Author PNGs under `assets/source/`
2. Describe them in `assets/spec/manifest.json`
3. Run `npm run assets:compile`
4. Commit the generated output in `src/generated/assets/`

Current constraints:

* strict 4-role mask palette only
* transparent background required
* directional/static base frames only
* no runtime PNG dependency
