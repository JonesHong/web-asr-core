# Test Directory Structure

## Organization

### `/local`
Local development testing files that use the built `dist` directory.
- `index.html` - Main test page for local development
- `script.js` - JavaScript code for local testing

### `/cdn`
CDN integration testing files for npm package deployment.
- `index_cdn.html` - Test page for CDN loading
- `script_cdn.js` - JavaScript code for CDN testing

### `/integration`
Integration and specialized testing scenarios.
- `test-whisper-remote.html` - Remote Whisper model testing
- `test-npm-install/` - NPM installation testing
- `test-npm-webpack/` - Webpack bundling testing

## Usage

### Local Testing
```bash
# Build the project first
npm run build:all

# Serve local test files
cd test/local
python3 -m http.server 8000
# Open http://localhost:8000/index.html
```

### CDN Testing
```bash
# After publishing to npm
cd test/cdn
python3 -m http.server 8000
# Open http://localhost:8000/index_cdn.html
```

### Integration Testing
```bash
cd test/integration
python3 -m http.server 8000
# Open specific test files as needed
```