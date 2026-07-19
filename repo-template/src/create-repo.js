#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import readline from 'readline'

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

const question = (prompt) =>
  new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer)
    })
  })

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
}

function print(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

function printHeader(title) {
  print('========================================', 'blue')
  print(title, 'blue')
  print('========================================', 'blue')
}

async function main() {
  try {
    printHeader('Repository Template Generator')

    // Get project name
    const projectName = await question(
      '\nProject name (e.g., my-awesome-project): '
    )

    if (!projectName.trim()) {
      print('✗ Project name cannot be empty', 'red')
      process.exit(1)
    }

    // Check if directory already exists
    if (fs.existsSync(projectName)) {
      print(`✗ Directory '${projectName}' already exists`, 'red')
      process.exit(1)
    }

    // Project type
    print('\nProject Type:', 'blue')
    const projectTypes = [
      'Full-stack web app (Node/React)',
      'Frontend only (React/Vue)',
      'Backend API (Node/Python)',
      'Game dev (Unity)',
      'Other',
    ]

    projectTypes.forEach((type, i) => {
      console.log(`${i + 1}. ${type}`)
    })

    const typeChoice = await question('Select project type (1-5): ')
    let projectType = 'full-stack'

    switch (typeChoice.trim()) {
      case '1':
        projectType = 'full-stack'
        break
      case '2':
        projectType = 'frontend'
        break
      case '3':
        projectType = 'backend'
        break
      case '4':
        projectType = 'game-dev'
        break
      case '5':
        projectType = 'other'
        break
      default:
        print('✗ Invalid selection', 'red')
        process.exit(1)
    }

    // Description
    const description = await question('\nProject description: ')

    // Author
    const author = await question('Author (your name): ')

    // Privacy
    print('\nRepository Privacy:', 'blue')
    console.log('1. Private')
    console.log('2. Public')
    const privacyChoice = await question('Select privacy (1-2): ')
    const isPrivate = privacyChoice.trim() === '1'

    rl.close()

    // Create directory structure
    printHeader('Creating repository structure')

    fs.mkdirSync(projectName, { recursive: true })
    process.chdir(projectName)

    // Create directories
    fs.mkdirSync('src', { recursive: true })
    fs.mkdirSync('tests', { recursive: true })
    fs.mkdirSync('docs', { recursive: true })
    fs.mkdirSync('.github/workflows', { recursive: true })

    print('✓ Created directory structure', 'green')

    // Create .gitignore
    const gitignoreContent = `# Dependencies
node_modules/
__pycache__/
*.pyc
venv/
env/

# Build & dist
dist/
build/
*.unitypackage
[Ll]ibrary/
[Tt]emp/
[Oo]bj/
[Bb]uild/

# Environment
.env
.env.local
.env.*.local

# IDE
.vscode/
.idea/
*.swp
*.swo
*~
*.sublime-workspace

# OS
.DS_Store
Thumbs.db

# Testing
coverage/
.nyc_output/

# Database
*.db
*.sqlite
postgres_data/
`

    fs.writeFileSync('.gitignore', gitignoreContent)
    print('✓ Created .gitignore', 'green')

    // Create .env.example
    const envContent = `# Environment configuration example
# Copy this file to .env and fill in your actual values

NODE_ENV=development
DEBUG=false
`

    fs.writeFileSync('.env.example', envContent)
    print('✓ Created .env.example', 'green')

    // Create README.md
    const readmeContent = `# ${projectName}

${description}

## Quick Start

See [SETUP.md](./SETUP.md) for detailed setup instructions.

### Prerequisites
- Node.js 18+
- [Other requirements for your project]

### Installation
\`\`\`bash
git clone https://github.com/irgendjemandkeinkorper/${projectName}.git
cd ${projectName}
npm install
# Follow SETUP.md for next steps
\`\`\`

## Project Structure

\`\`\`
${projectName}/
├── src/              # Source code
├── tests/            # Test files
├── docs/             # Documentation
└── README.md
\`\`\`

For detailed architecture, see [ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Development

\`\`\`bash
npm install
npm run dev
npm test
\`\`\`

## Contributing

See [CONTRIBUTING.md](./docs/CONTRIBUTING.md) for guidelines.

## License

MIT

---

**Author:** ${author}
**Created:** ${new Date().toISOString().split('T')[0]}
**Privacy:** ${isPrivate ? 'Private' : 'Public'}
`

    fs.writeFileSync('README.md', readmeContent)
    print('✓ Created README.md', 'green')

    // Create SETUP.md
    const setupContent = `# Development Setup

## Prerequisites

- Node.js 18+
- npm 9+
- [Other tools for your project]

## Installation

### 1. Clone the Repository

\`\`\`bash
git clone https://github.com/irgendjemandkeinkorper/${projectName}.git
cd ${projectName}
\`\`\`

### 2. Install Dependencies

\`\`\`bash
npm install
\`\`\`

### 3. Configure Environment

\`\`\`bash
cp .env.example .env
# Edit .env with your configuration
\`\`\`

### 4. Start Development

\`\`\`bash
npm run dev
\`\`\`

## Available Scripts

- \`npm run dev\` - Start development server
- \`npm run build\` - Build for production
- \`npm start\` - Start production server
- \`npm test\` - Run tests
- \`npm run lint\` - Run linter

## Troubleshooting

[Add troubleshooting tips here]

## Next Steps

- Read [ARCHITECTURE.md](./docs/ARCHITECTURE.md) for technical details
- Check [CONTRIBUTING.md](./docs/CONTRIBUTING.md) for contribution guidelines
`

    fs.writeFileSync('SETUP.md', setupContent)
    print('✓ Created SETUP.md', 'green')

    // Create ARCHITECTURE.md
    const archContent = `# Architecture

## Project Overview

${description}

## Technology Stack

### Languages
- [Your language(s)]

### Frameworks & Libraries
- [Your frameworks]

### Database/Storage
- [Database or storage]

### Tools
- [Build tools, etc.]

## Directory Structure

\`\`\`
src/
├── [your structure]
└── [organized by feature or type]
\`\`\`

## Design Decisions

1. **Decision 1** - Reasoning
2. **Decision 2** - Trade-offs

## Data Flow

[Describe how data flows through your app]

## External Integrations

[Any APIs or services used]

## Future Improvements

- [Planned enhancements]
`

    fs.writeFileSync('docs/ARCHITECTURE.md', archContent)
    print('✓ Created ARCHITECTURE.md', 'green')

    // Create CONTRIBUTING.md
    const contribContent = `# Contributing Guidelines

## Getting Started

1. Clone the repository
2. Follow [SETUP.md](../SETUP.md)
3. Create a feature branch: \`git checkout -b feature/your-feature\`

## Development Workflow

1. Make changes
2. Run tests: \`npm test\`
3. Commit: \`git commit -m "type: description"\`
4. Push: \`git push origin feature/your-feature\`
5. Create Pull Request

## Code Style

- Follow existing conventions
- Use clear naming
- Add comments for complex logic
- Run linter: \`npm run lint\`

## Git Workflow

**Branches:**
- \`main\` - Production code
- \`feature/name\` - New features
- \`bugfix/name\` - Bug fixes

**Commits:**
Use conventional commits: \`feat:\`, \`fix:\`, \`docs:\`, \`test:\`, \`chore:\`

## Pull Request Process

- Clear title and description
- Link related issues
- Ensure tests pass
- Request review

Thanks for contributing! 🎉
`

    fs.writeFileSync('docs/CONTRIBUTING.md', contribContent)
    print('✓ Created CONTRIBUTING.md', 'green')

    // Create package.json
    const packageJsonContent = {
      name: projectName,
      version: '0.1.0',
      description: description,
      author: author,
      private: true,
      type: 'module',
      scripts: {
        dev: 'node src/index.js',
        build: 'echo "Add build script"',
        start: 'node dist/index.js',
        test: 'echo "Add test script"',
        lint: 'echo "Add lint script"',
      },
      keywords: [],
      dependencies: {},
      devDependencies: {
        typescript: '^5.2.0',
      },
      engines: {
        node: '>=18.0.0',
      },
    }

    fs.writeFileSync('package.json', JSON.stringify(packageJsonContent, null, 2))
    print('✓ Created package.json', 'green')

    // Create LICENSE
    const licenseContent = `MIT License

Copyright (c) 2026 ${author}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`

    fs.writeFileSync('LICENSE', licenseContent)
    print('✓ Created LICENSE', 'green')

    // Initialize git
    try {
      execSync('git init', { stdio: 'ignore' })
      execSync('git add .', { stdio: 'ignore' })
      execSync('git commit -m "Initial commit: Repository setup with standard template"', {
        stdio: 'ignore',
      })
      print('✓ Initialized git repository', 'green')
    } catch (e) {
      print('⚠ Git initialization skipped', 'yellow')
    }

    // Success message
    printHeader('Repository Created Successfully!')
    console.log('')
    print('✓ Configuration:', 'green')
    console.log(`  Project Name: ${projectName}`)
    console.log(`  Type: ${projectType}`)
    console.log(`  Author: ${author}`)
    console.log(`  Private: ${isPrivate}`)
    console.log('')
    print('📋 Next Steps:', 'blue')
    console.log('1. Review the generated files')
    console.log('2. Customize ARCHITECTURE.md for your tech stack')
    console.log('3. Create repository on GitHub: https://github.com/new')
    console.log('4. Push to GitHub:')
    console.log('')
    console.log(`   git branch -M main`)
    console.log(`   git remote add origin https://github.com/irgendjemandkeinkorper/${projectName}.git`)
    console.log(`   git push -u origin main`)
    console.log('')
    print('Happy coding! 🚀', 'green')
  } catch (error) {
    print(`✗ Error: ${error.message}`, 'red')
    process.exit(1)
  }
}

main()
