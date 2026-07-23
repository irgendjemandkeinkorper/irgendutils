# Quick Start Guide

Get the HTML to Gutenberg converter up and running in 5 minutes.

## Prerequisites

- Node.js 18+ ([download](https://nodejs.org))
- npm or yarn
- Git (optional, for version control)

## Option 1: Manual Setup

### 1. Create Project Structure

```bash
mkdir html-to-gutenberg
cd html-to-gutenberg

# Frontend
mkdir -p frontend/src/{components,services,pages,types,hooks,assets}
mkdir -p frontend/{public,node_modules}

# Backend
mkdir -p backend/src/{routes,services,types}
mkdir -p backend/node_modules

# Shared
mkdir shared
```

### 2. Frontend Setup

**Create `frontend/package.json`**:
```json
{
  "name": "html-to-gutenberg-frontend",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "cheerio": "^1.0.0-rc.12",
    "@tanstack/react-query": "^5.0.0"
  },
  "devDependencies": {
    "vite": "^4.5.0",
    "@vitejs/plugin-react": "^4.2.0",
    "typescript": "^5.3.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "tailwindcss": "^3.3.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0"
  }
}
```

**Create `frontend/vite.config.ts`**:
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000'
    }
  }
})
```

**Create `frontend/tsconfig.json`**:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"]
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.app.json" }]
}
```

**Create `frontend/src/main.tsx`**:
```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

**Create `frontend/src/App.tsx`**:
```typescript
import { useState } from 'react'
import { InputSelector } from './components/InputSelector'
import { useConversion } from './hooks/useConversion'

function App() {
  const { state, selectInputType, handleHtmlSubmit } = useConversion()

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-2">HTML to Gutenberg Converter</h1>
        <p className="text-gray-600 mb-8">Convert your HTML to WordPress Gutenberg blocks</p>

        {state.step === 'input' && (
          <InputSelector state={state} onSelect={selectInputType} />
        )}

        {state.step === 'source' && (
          <div className="bg-white rounded-lg p-8 border border-gray-200">
            <h2 className="text-2xl font-bold mb-4">Paste your HTML</h2>
            <textarea
              className="w-full h-64 p-4 border border-gray-300 rounded font-mono text-sm"
              placeholder="<h1>Title</h1><p>Content</p>"
              onChange={(e) => handleHtmlSubmit(e.target.value)}
            />
          </div>
        )}

        {state.loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin">⏳</div>
            <p className="mt-4 text-gray-600">Converting...</p>
          </div>
        )}

        {state.error && (
          <div className="bg-red-50 border border-red-200 rounded p-4 text-red-800">
            Error: {state.error}
          </div>
        )}
      </div>
    </div>
  )
}

export default App
```

**Create `frontend/index.html`**:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>HTML to Gutenberg Converter</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Install dependencies**:
```bash
cd frontend
npm install
```

### 3. Backend Setup

**Create `backend/package.json`**:
```json
{
  "name": "html-to-gutenberg-backend",
  "version": "0.1.0",
  "main": "dist/server.js",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "express": "^4.18.0",
    "cors": "^2.8.5",
    "multer": "^1.4.5-lts.1",
    "cheerio": "^1.0.0-rc.12",
    "dotenv": "^16.3.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/express": "^4.17.0",
    "@types/node": "^20.0.0",
    "@types/multer": "^1.4.0",
    "tsx": "^4.0.0"
  }
}
```

**Create `backend/tsconfig.json`**:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node"
  },
  "include": ["src"],
  "exclude": ["node_modules"]
}
```

**Create `backend/src/server.ts`**:
```typescript
import app from './app.js'

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`)
  console.log(`📝 API docs: http://localhost:${PORT}/api/docs`)
})
```

**Create `backend/src/app.ts`**:
```typescript
import express from 'express'
import cors from 'cors'
import multer from 'multer'

const app = express()
const upload = multer({ storage: multer.memoryStorage() })

// Middleware
app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.text({ limit: '10mb' }))

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

// Placeholder routes
app.post('/api/convert', upload.single('file'), (req, res) => {
  const html = req.body || (req.file ? req.file.buffer.toString() : '')
  
  // TODO: Call actual conversion logic
  res.json({
    success: true,
    data: {
      blocks: [],
      flaggedSections: [],
      warnings: [],
      metadata: {
        inputType: 'snippet',
        totalBlocks: 0,
        conversionTime: 0
      }
    }
  })
})

export default app
```

**Create `.env.example`** (in backend root):
```
PORT=3000
NODE_ENV=development
WORDPRESS_API_URL=https://wordpress.local
API_KEY=your_api_key_here
```

**Install dependencies**:
```bash
cd ../backend
npm install
```

### 4. Shared Types

**Create `shared/types.ts`** (copy from the build guide, shared/types.ts section)

**Create `shared/constants.ts`** (copy from the build guide, shared/constants.ts section)

### 5. Run Both Servers

**Terminal 1 - Frontend**:
```bash
cd frontend
npm run dev
# Opens http://localhost:5173
```

**Terminal 2 - Backend**:
```bash
cd backend
npm run dev
# Runs on http://localhost:3000
```

---

## Option 2: Automated Setup Script

**Create `setup.sh`** in project root:

```bash
#!/bin/bash
set -e

echo "🚀 Setting up HTML to Gutenberg Converter..."

# Frontend
echo "📦 Setting up frontend..."
mkdir -p frontend/src/{components,services,pages,types,hooks}
cd frontend
npm init -y
npm install react react-dom cheerio @tanstack/react-query
npm install --save-dev vite @vitejs/plugin-react typescript @types/react @types/react-dom tailwindcss postcss autoprefixer
cd ..

# Backend
echo "📦 Setting up backend..."
mkdir -p backend/src/{routes,services,types}
cd backend
npm init -y
npm install express cors multer cheerio dotenv
npm install --save-dev typescript @types/express @types/node @types/multer tsx
cd ..

# Create essential files
echo "📝 Creating configuration files..."

# Frontend vite.config.ts
cat > frontend/vite.config.ts << 'EOF'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000'
    }
  }
})
EOF

# Backend app.ts
cat > backend/src/app.ts << 'EOF'
import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors())
app.use(express.json())

app.get('/health', (req, res) => res.json({ status: 'ok' }))

export default app
EOF

# Backend server.ts
cat > backend/src/server.ts << 'EOF'
import app from './app.js'
const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`))
EOF

echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Frontend: cd frontend && npm run dev"
echo "2. Backend: cd backend && npm run dev"
```

**Run setup**:
```bash
chmod +x setup.sh
./setup.sh
```

---

## File Creation Checklist

Use this checklist to ensure all files are created:

### Frontend
- [ ] `frontend/package.json`
- [ ] `frontend/vite.config.ts`
- [ ] `frontend/tsconfig.json`
- [ ] `frontend/index.html`
- [ ] `frontend/src/main.tsx`
- [ ] `frontend/src/App.tsx`
- [ ] `frontend/src/types/index.ts`
- [ ] `frontend/src/services/parser.ts`
- [ ] `frontend/src/services/blockMapper.ts`
- [ ] `frontend/src/services/flagDetector.ts`
- [ ] `frontend/src/services/wpExporter.ts`
- [ ] `frontend/src/hooks/useConversion.ts`
- [ ] `frontend/src/components/InputSelector.tsx`
- [ ] `frontend/src/components/SourceUpload.tsx`
- [ ] `frontend/src/components/ConversionReview.tsx`
- [ ] `frontend/src/components/ExportOptions.tsx`

### Backend
- [ ] `backend/package.json`
- [ ] `backend/tsconfig.json`
- [ ] `backend/src/server.ts`
- [ ] `backend/src/app.ts`
- [ ] `backend/src/routes/convert.ts`
- [ ] `backend/src/routes/crawl.ts`
- [ ] `backend/src/services/parser.ts`
- [ ] `backend/.env.example`

### Shared
- [ ] `shared/types.ts`
- [ ] `shared/constants.ts`

---

## First Test

Once both servers are running:

1. Open http://localhost:5173 in your browser
2. Click "Code Snippet"
3. Paste this HTML:
   ```html
   <h1>Hello World</h1>
   <p>This is a test.</p>
   ```
4. Should see the conversion result

---

## Building Core Services in Order

Once scaffolding is done, implement in this order:

1. **HtmlParser** (`frontend/src/services/parser.ts`)
   - Test: `parser.parse('<h1>Test</h1>')` returns tree

2. **BlockMapper** (`frontend/src/services/blockMapper.ts`)
   - Test: Maps `<h1>` to `core/heading` block

3. **FlagDetector** (`frontend/src/services/flagDetector.ts`)
   - Test: Detects SVG, complex layouts

4. **useConversion Hook** (`frontend/src/hooks/useConversion.ts`)
   - Ties parsers + mappers + flags together

5. **Components**
   - InputSelector
   - ConversionReview
   - ExportOptions

6. **WpExporter** (`frontend/src/services/wpExporter.ts`)
   - JSON and HTML export

7. **Backend Routes** (add as needed)
   - `/api/convert` for full processing
   - `/api/crawl` for full-site

---

## Debugging Tips

**Frontend**:
```typescript
// In any component
console.log('State:', state)
console.log('HTML:', sourceHtml)
console.log('Blocks:', result.blocks)
```

**Backend**:
```typescript
console.error('Parse error:', error)
res.status(500).json({ success: false, error: error.message })
```

**Network**:
```bash
# Test API
curl -X POST http://localhost:3000/api/convert \
  -H "Content-Type: application/json" \
  -d '{"html":"<h1>Test</h1>","inputType":"snippet"}'
```

---

## Next: Integration with Claude Code

Once this is set up, you can use Claude Code to:

1. **Build the parsing logic** step-by-step
2. **Add component functionality** with hot reload
3. **Test conversions** in the browser immediately
4. **Debug issues** with full IDE support

Run Claude Code from the project root and it will have access to all files.

---

## Common Issues

| Issue | Fix |
|-------|-----|
| Port already in use | Kill process: `lsof -i :5173` then `kill -9 PID` |
| Module not found | Reinstall: `npm install` |
| CORS errors | Check backend CORS config |
| Vite not reloading | Clear cache: `rm -rf .vite` |
| TypeScript errors | Run `tsc --noEmit` to check |

---

## Deploy to Production

### Frontend (Vercel)
```bash
cd frontend
npm run build
# Deploy ./dist folder
```

### Backend (Railway/Render)
```bash
cd backend
npm run build
npm start
```

See `docker-compose.yml` in main guide for Docker setup.
