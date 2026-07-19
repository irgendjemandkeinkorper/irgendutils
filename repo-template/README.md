# @irgendutils/repo-template

Interactive repository template generator for creating new projects with consistent structure and documentation.

## Features

- 🎯 Interactive CLI for project configuration
- 📁 Automatic directory structure setup
- 📝 Pre-built documentation templates
- 🎨 Supports multiple project types (full-stack, frontend, backend, game dev)
- 🔧 Ready-to-use npm scripts
- 🐙 Git initialization included

## Installation

### Global (Recommended)
```bash
npm install -g @irgendutils/repo-template
```

Then use anywhere:
```bash
create-repo
# or
repo-template
```

### Local to Monorepo
```bash
cd irgendutils
npm install
npx @irgendutils/repo-template
```

## Usage

```bash
create-repo
```

The tool will guide you through:
1. Project name
2. Project type (full-stack, frontend, backend, game dev, other)
3. Description
4. Author name
5. Privacy setting (private/public)

### Example

```bash
$ create-repo
========================================
Repository Template Generator
========================================

Project name (e.g., my-awesome-project): my-cool-app
Project Type:
1. Full-stack web app (Node/React)
2. Frontend only (React/Vue)
3. Backend API (Node/Python)
4. Game dev (Unity)
5. Other
Select project type (1-5): 1

Project description: A cool web application

Author (your name): Adam

Repository Privacy:
1. Private
2. Public
Select privacy (1-2): 1

========================================
Creating repository structure
========================================
✓ Created directory structure
✓ Created .gitignore
✓ Created .env.example
✓ Created README.md
✓ Created SETUP.md
✓ Created ARCHITECTURE.md
✓ Created CONTRIBUTING.md
✓ Created package.json
✓ Created LICENSE
✓ Initialized git repository

========================================
Repository Created Successfully!
========================================

✓ Configuration:
  Project Name: my-cool-app
  Type: full-stack
  Author: Adam
  Private: true

📋 Next Steps:
1. Review the generated files
2. Customize ARCHITECTURE.md for your tech stack
3. Create repository on GitHub: https://github.com/new
4. Push to GitHub:

   git branch -M main
   git remote add origin https://github.com/irgendjemandkeinkorper/my-cool-app.git
   git push -u origin main

Happy coding! 🚀
```

## Generated Files

### Documentation
- **README.md** - Project overview and quick start
- **SETUP.md** - Development environment setup
- **docs/ARCHITECTURE.md** - Technical design and decisions
- **docs/CONTRIBUTING.md** - Contribution guidelines

### Configuration
- **package.json** - npm configuration with standard scripts
- **.gitignore** - Sensible defaults for common file types
- **.env.example** - Environment variable template
- **LICENSE** - MIT license

### Directory Structure
```
project-name/
├── src/              # Source code
├── tests/            # Test files
├── docs/             # Documentation
│   ├── ARCHITECTURE.md
│   └── CONTRIBUTING.md
├── .github/
│   └── workflows/    # CI/CD (for future use)
├── README.md
├── SETUP.md
├── package.json
├── .gitignore
├── .env.example
└── LICENSE
```

## Supported Project Types

- **Full-stack web app** - Node.js/React, with frontend and backend
- **Frontend only** - React, Vue, or other UI libraries
- **Backend API** - Node.js, Python, or other server-side
- **Game dev** - Unity, Godot, or other game engines
- **Other** - Custom structure

## Next Steps After Generation

1. **Customize documentation** - Update ARCHITECTURE.md with your tech stack
2. **Install dependencies** - Run `npm install` to add your packages
3. **Create GitHub repo** - Go to https://github.com/new
4. **Push to GitHub** - Follow the generated instructions
5. **Start developing!** - Your project is ready to go

## Advanced Options

The generator uses sensible defaults, but you can customize:
- Language/framework choices in generated `package.json`
- .gitignore entries based on your project type
- Environment variables in `.env.example`
- Directory structure (after generation)

## Contributing

See the [contributing guidelines](../../docs/CONTRIBUTING.md) in the main repository.

## License

MIT

---

Part of the [irgendutils](https://github.com/irgendjemandkeinkorper/irgendutils) monorepo.
