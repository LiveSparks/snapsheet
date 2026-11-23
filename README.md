# SNAPSHEET

SNAPSHEET is a browser-based photo sheet composer for inkjet printing. Photos stay in the browser; no server or account is required.

## Features

- Import common image formats, including HEIC/HEIF, by file picker, drag and drop, or paste.
- Compose sheets using flow, polaroid, or fixed-grid layouts — or freeform, where every photo is placed and sized individually with snapping, alignment, multi-select, preset and custom sizes, and undo.
- Configure paper size, orientation, margins, spacing, DPI, crop, rotation, captions, and guides.
- Adjust brightness, contrast, saturation, and sharpening per photo or in batches.
- Export printable PNG/JPEG sheets or a PDF, and print at the selected physical size.

All photo processing happens locally in the browser. The application does not upload images to a server.

Photos, per-photo edits and layouts are saved in the browser (IndexedDB), so a page reload picks up where you left off. Use **New** (or **Clear roll**) to start a blank project.

## Development

The app is a static site with no framework or runtime dependencies. After installing Node.js, run:

```sh
npm run build
```

Serve the repository root with any static web server, for example `npx serve .`, then open the printed local URL. Opening the HTML directly also works, although browser security rules can affect clipboard and image features.

For a quick local preview:

```sh
npm run build
npx serve .
```

### Run With Python

Node.js is not required to serve the already-built site. From the repository root, run:

```sh
python -m http.server 8000
```

Then open <http://localhost:8000> in your browser. On some systems, use `python3` instead:

```sh
python3 -m http.server 8000
```

If port `8000` is already in use, choose another port, for example `python -m http.server 8080`. Python serves the generated root files (`index.html`, `styles.css`, and `app.js`); run `npm run build` after changing files under `src/` so those generated files are refreshed.

Source is split into:

- `src/index.html`: page structure and accessible controls
- `src/styles.css`: visual design and responsive layout
- `src/js/`: focused JavaScript modules for utilities/state, image processing, layout, rendering, editor behavior, export, and UI wiring

The root files are the deployable GitHub Pages artifact. The build copies the source files into the root, concatenates the ordered JavaScript modules into `app.js`, and creates `.nojekyll`.

## GitHub Pages

Push the repository to GitHub with the default branch named `main`. The included workflow deploys automatically on every push to `main`.

In the repository settings, open **Pages** and set the source to **GitHub Actions**. After the workflow completes, GitHub shows the published URL in the workflow run and Pages settings.

The deployment workflow is located at `.github/workflows/pages.yml`. It rebuilds the root deployment files from `src/` before uploading the site.

## External Libraries

The browser loads the following libraries from jsDelivr at runtime:

- `libheif-js` and `heic2any` for HEIC/HEIF decoding
- `jsPDF` for PDF export
- Google Fonts for the application typography

These features require an internet connection unless the CDN assets are self-hosted.
