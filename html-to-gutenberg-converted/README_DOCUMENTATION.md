# HTML to Gutenberg Converter - Complete Documentation Index

Welcome! This folder contains everything you need to build the HTML to Gutenberg blocks converter app using Claude Code.

## 📚 Documentation Files

### 1. **HTML_TO_GUTENBERG_BUILD_GUIDE.md** ⭐ START HERE
The comprehensive blueprint covering:
- Complete project architecture
- File structure for frontend, backend, and shared code
- Detailed explanations of all core services (parser, mapper, detector, exporter)
- Complete React component implementations
- Backend API setup
- 3-phase implementation plan
- Running instructions

**When to use**: Read this first to understand the overall architecture, then reference specific sections while coding.

---

### 2. **QUICK_START.md** ⭐ DO THIS SECOND
Fast-track to getting the project running:
- Prerequisites and setup options
- Step-by-step manual setup (or automated with shell script)
- `package.json` templates for both frontend and backend
- File creation checklist
- First test instructions
- Debugging tips and common issues

**When to use**: After reading the build guide, use this to set up your project files quickly.

---

### 3. **API_SPECIFICATIONS.md**
Detailed API reference:
- All REST endpoints with request/response examples
- WordPress integration details
- Block JSON structure specifications
- HTML → Block mapping rules table
- Error handling standards
- Rate limiting
- Testing payloads

**When to use**: When building backend routes or exporting/importing features.

---

### 4. **IMPLEMENTATION_GOTCHAS.md**
Real-world troubleshooting and best practices:
- 14 common pitfalls with code examples
- State management patterns
- Performance optimization
- WordPress integration gotchas
- Test fixtures for all scenarios
- Checklists for performance, accessibility, launch
- Debug strategies

**When to use**: When stuck on a problem; search for relevant section before Googling.

---

## 🚀 How to Use This Documentation

### Path 1: Complete Beginner
1. Read **HTML_TO_GUTENBERG_BUILD_GUIDE.md** (full)
2. Follow **QUICK_START.md** for project setup
3. Reference **API_SPECIFICATIONS.md** while building routes
4. Consult **IMPLEMENTATION_GOTCHAS.md** when debugging

**Time estimate**: 1-2 weeks for full MVP

---

### Path 2: Experienced Developer
1. Skim **HTML_TO_GUTENBERG_BUILD_GUIDE.md** (focus on architecture diagram and phase overview)
2. Use **QUICK_START.md** to scaffold quickly
3. Implement services based on the code examples in the build guide
4. Reference **API_SPECIFICATIONS.md** for block schema details

**Time estimate**: 3-5 days for full MVP

---

### Path 3: Quick Reference (When Building)
- Building components? → HTML_TO_GUTENBERG_BUILD_GUIDE.md (Components section)
- Building services? → HTML_TO_GUTENBERG_BUILD_GUIDE.md (Services section)
- Stuck on a problem? → IMPLEMENTATION_GOTCHAS.md
- Need API format? → API_SPECIFICATIONS.md
- Need to set up files? → QUICK_START.md

---

## 📋 File Organization in Your Project

```
html-to-gutenberg/
├── frontend/
│   ├── src/
│   │   ├── components/        ← Build from HTML_TO_GUTENBERG_BUILD_GUIDE.md
│   │   ├── services/          ← Build from HTML_TO_GUTENBERG_BUILD_GUIDE.md
│   │   ├── pages/
│   │   ├── types/             ← Copy from shared/types.ts in build guide
│   │   └── hooks/
│   ├── package.json           ← From QUICK_START.md
│   ├── vite.config.ts         ← From QUICK_START.md
│   └── tsconfig.json          ← From QUICK_START.md
│
├── backend/
│   ├── src/
│   │   ├── routes/            ← Build based on API_SPECIFICATIONS.md
│   │   └── services/
│   ├── package.json           ← From QUICK_START.md
│   ├── tsconfig.json          ← From QUICK_START.md
│   └── .env.example           ← From QUICK_START.md
│
├── shared/
│   ├── types.ts               ← From HTML_TO_GUTENBERG_BUILD_GUIDE.md
│   └── constants.ts           ← From HTML_TO_GUTENBERG_BUILD_GUIDE.md
│
└── docs/
    ├── HTML_TO_GUTENBERG_BUILD_GUIDE.md
    ├── QUICK_START.md
    ├── API_SPECIFICATIONS.md
    └── IMPLEMENTATION_GOTCHAS.md
```

---

## 🔄 Implementation Order

### Phase 1: Setup (1-2 hours)
1. Follow QUICK_START.md to scaffold project
2. Get both frontend and backend servers running
3. Confirm API proxy is working (frontend → backend)

### Phase 2: Core Parsing (1 day)
1. Implement `HtmlParser` (QUICK_START.md → services section)
2. Implement `BlockMapper` (HTML_TO_GUTENBERG_BUILD_GUIDE.md → blockMapper.ts)
3. Write unit tests with fixtures from IMPLEMENTATION_GOTCHAS.md
4. Test with simple HTML

### Phase 3: Flag Detection (1 day)
1. Implement `FlagDetector` (from build guide)
2. Add test cases for each flag type
3. Test with complex HTML from IMPLEMENTATION_GOTCHAS.md

### Phase 4: React Integration (1 day)
1. Implement `useConversion` hook
2. Build `InputSelector` component
3. Build `ConversionReview` component
4. Wire together in App.tsx

### Phase 5: Export & Polish (1-2 days)
1. Implement `WpExporter`
2. Build `ExportOptions` component
3. Test exports in WordPress
4. Fix any formatting issues (consult IMPLEMENTATION_GOTCHAS.md)

### Phase 6: Backend Routes (1 day)
1. Create `/api/convert` endpoint
2. Create `/api/export` endpoint
3. Test with POSTMAN using payloads from API_SPECIFICATIONS.md

---

## 🎯 Key Decisions Already Made For You

These are baked into the documentation. No need to redesign:

✅ **Parser**: Cheerio (works client & server side, good for this use case)  
✅ **State**: React hooks + localStorage (simple, sufficient for MVP)  
✅ **Export formats**: JSON + WordPress HTML comments (most compatible)  
✅ **Fallback blocks**: 5 options (Group, Columns, Cover, Custom HTML, Skip)  
✅ **API style**: RESTful with clear request/response format  
✅ **Block support**: Focus on 12 most common blocks (can extend later)

---

## 🛠️ Using Claude Code to Build

### Setup Claude Code
```bash
# In your project root
code . # Opens in VS Code
# Then install Claude Code extension
```

### Building with Claude Code
1. Open the project in VS Code
2. Open Claude Code (Cmd+Shift+P → "Claude Code")
3. Paste the relevant section from **HTML_TO_GUTENBERG_BUILD_GUIDE.md**
4. It will show diffs and create/update files automatically
5. Review changes, then accept

**Example prompt for Claude Code**:
```
I want to build the HtmlParser service. Here's the specification:
[Paste HtmlParser section from build guide]

Create the file frontend/src/services/parser.ts with this implementation.
```

---

## ✅ Testing Checklist

### Unit Tests (Before Integration)
- [ ] HtmlParser correctly builds DOM tree from HTML string
- [ ] BlockMapper converts each HTML element to correct block
- [ ] FlagDetector catches all 10+ flag types
- [ ] WpExporter produces valid WordPress block JSON

### Integration Tests
- [ ] Full flow: HTML → Parse → Map → Detect Flags → Export
- [ ] Flag resolution: User picks block → applies correctly
- [ ] Export formats: JSON is valid, HTML has correct comments

### Manual Tests
- [ ] Open http://localhost:5173
- [ ] Paste test HTML from IMPLEMENTATION_GOTCHAS.md
- [ ] Convert and review results
- [ ] Copy JSON and paste into WordPress (test if possible)

### Edge Case Tests
- [ ] Empty HTML
- [ ] Single tag
- [ ] Deeply nested HTML (10+ levels)
- [ ] HTML with special characters
- [ ] Invalid/unclosed tags
- [ ] Very large HTML (>1MB)

---

## 🐛 When You Get Stuck

1. **Check error message** → Search IMPLEMENTATION_GOTCHAS.md
2. **Read related section** in build guide
3. **Look at test fixtures** in IMPLEMENTATION_GOTCHAS.md
4. **Check API spec** if it's a format issue
5. **Test in isolation** (single component/service)
6. **Use browser DevTools** → Network, Console, Elements

**Common issues**:
- "Module not found" → Run `npm install` in frontend/backend
- "Port already in use" → Kill process or change port in vite.config.ts
- "CORS error" → Check backend CORS config in app.ts
- "Blocks not exporting" → Check JSON structure against API_SPECIFICATIONS.md

---

## 📖 Documentation by Topic

### Understanding the Architecture
- Read: HTML_TO_GUTENBERG_BUILD_GUIDE.md → Overview section
- Diagram: Mentally visualize parser → mapper → detector → exporter pipeline

### HTML Parsing
- Read: HTML_TO_GUTENBERG_BUILD_GUIDE.md → services/parser.ts
- Gotchas: IMPLEMENTATION_GOTCHAS.md → Sections 1, 4, 5, 6

### Block Mapping
- Read: HTML_TO_GUTENBERG_BUILD_GUIDE.md → services/blockMapper.ts
- Reference: API_SPECIFICATIONS.md → Block Mapping table
- Gotchas: IMPLEMENTATION_GOTCHAS.md → Sections 2, 3, 7, 9, 13

### Flag Detection
- Read: HTML_TO_GUTENBERG_BUILD_GUIDE.md → services/flagDetector.ts
- Gotchas: IMPLEMENTATION_GOTCHAS.md → Sections 8, 11

### Exporting
- Read: HTML_TO_GUTENBERG_BUILD_GUIDE.md → services/wpExporter.ts
- Spec: API_SPECIFICATIONS.md → WordPress Import Flow

### React Components
- Read: HTML_TO_GUTENBERG_BUILD_GUIDE.md → Components section
- Gotcha: IMPLEMENTATION_GOTCHAS.md → Section 10 (State Management)

### Backend API
- Read: HTML_TO_GUTENBERG_BUILD_GUIDE.md → Backend section
- Spec: API_SPECIFICATIONS.md (all endpoints)
- Gotcha: IMPLEMENTATION_GOTCHAS.md → Sections 12, 13

### Performance
- Read: QUICK_START.md → Debugging Tips
- Gotcha: IMPLEMENTATION_GOTCHAS.md → Section 12
- Checklist: IMPLEMENTATION_GOTCHAS.md → Performance Checklist

### Testing
- Read: IMPLEMENTATION_GOTCHAS.md → Section 14
- Fixtures: IMPLEMENTATION_GOTCHAS.md → Testing without Real HTML

---

## 🚀 Going from MVP to Production

After completing the MVP, use this priority order to add features:

### Phase 2: Enhancement (1-2 weeks)
1. Full-site crawling (`/api/crawl` endpoint)
2. Template reference matching
3. Side-by-side preview UI
4. Media asset bundling
5. User accounts & history

### Phase 3: Advanced (2-4 weeks)
1. WordPress direct integration (import button)
2. Custom block support
3. Performance optimization (streaming)
4. Analytics
5. API key system

---

## 📞 Need More Details?

Each documentation file has:
- **Detailed explanations** of design decisions
- **Code examples** showing right vs. wrong approaches
- **Testing strategies** for each component
- **Troubleshooting** sections for common issues

**Structure**:
1. Start with QUICK_START.md for hands-on learning
2. Reference HTML_TO_GUTENBERG_BUILD_GUIDE.md for detailed specs
3. Check IMPLEMENTATION_GOTCHAS.md when debugging
4. Use API_SPECIFICATIONS.md for integration details

---

## 📝 Notes for You

- This documentation was built to work seamlessly with **Claude Code** for local development
- All code examples are production-ready (not pseudo-code)
- The architecture is designed to handle the three input modes cleanly
- Test fixtures and gotchas are based on real-world HTML conversion scenarios

---

## 🎉 Summary

You have everything needed to build a professional HTML to Gutenberg converter:

✅ Complete architecture  
✅ Phase-by-phase implementation guide  
✅ All code samples (copy-paste ready)  
✅ API specifications  
✅ Testing strategies  
✅ Troubleshooting guide  
✅ Production deployment info  

**Next step**: Open QUICK_START.md and start building!

---

**Good luck! 🚀**

Questions? Refer back to the appropriate documentation file. Every major decision and common pitfall is covered.
