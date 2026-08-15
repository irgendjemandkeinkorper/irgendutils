#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { generateRedirectMap } from './engine/matcher.js';
import { validateRedirectMap } from './engine/validator.js';
import { exportRules } from './engine/generator.js';

const program = new Command();

program
  .name('redirect-gen')
  .description('Generate and validate reviewable redirect maps from migration crawl manifests before launch.')
  .version('1.0.0');

program
  .command('generate')
  .description('Propose matches and generate redirect map rules.')
  .requiredOption('-s, --source <file>', 'Path to source legacy manifest JSON file')
  .option('-d, --destination <file>', 'Path to destination sitemap XML, JSON manifest, or text sitemap file')
  .option('-ov, --overrides <file>', 'Path to manual overrides file (JSON or CSV)')
  .option('-o, --out <dir>', 'Output directory for generated maps and rules', './out')
  .action(async (options) => {
    try {
      const sourcePath = path.resolve(options.source);
      if (!fs.existsSync(sourcePath)) {
        console.error(`Error: Source file does not exist at ${sourcePath}`);
        process.exit(1);
      }

      let destPath = null;
      if (options.destination) {
        destPath = path.resolve(options.destination);
        if (!fs.existsSync(destPath)) {
          console.error(`Error: Destination file does not exist at ${destPath}`);
          process.exit(1);
        }
      }

      let overridesPath = null;
      if (options.overrides) {
        overridesPath = path.resolve(options.overrides);
        if (!fs.existsSync(overridesPath)) {
          console.error(`Error: Overrides file does not exist at ${overridesPath}`);
          process.exit(1);
        }
      }

      const outDir = path.resolve(options.out);
      fs.mkdirSync(outDir, { recursive: true });

      console.log('Generating redirect maps...');
      const result = await generateRedirectMap({
        sourcePath,
        destPath,
        overridesPath,
      });

      // Save files
      const jsonMapPath = path.join(outDir, 'redirect-map.json');
      fs.writeFileSync(jsonMapPath, JSON.stringify(result.map, null, 2));
      console.log(`✓ Saved redirect-map.json to ${jsonMapPath}`);

      const csvMapPath = path.join(outDir, 'redirect-map.csv');
      fs.writeFileSync(csvMapPath, result.csv);
      console.log(`✓ Saved redirect-map.csv to ${csvMapPath}`);

      // Export server rules
      const rules = exportRules(result.map);

      const apachePath = path.join(outDir, 'apache.htaccess');
      fs.writeFileSync(apachePath, rules.apache);
      console.log(`✓ Saved apache.htaccess to ${apachePath}`);

      const nginxRewritePath = path.join(outDir, 'nginx-rewrite.conf');
      fs.writeFileSync(nginxRewritePath, rules.nginxRewrite);
      console.log(`✓ Saved nginx-rewrite.conf to ${nginxRewritePath}`);

      const nginxMapPath = path.join(outDir, 'nginx-map.conf');
      fs.writeFileSync(nginxMapPath, rules.nginxMap);
      console.log(`✓ Saved nginx-map.conf to ${nginxMapPath}`);

      console.log('\nMatch Statistics:');
      console.log(`- Total legacy paths: ${result.stats.total}`);
      console.log(`- Exact matches: ${result.stats.exact}`);
      console.log(`- Confident matches: ${result.stats.confident}`);
      console.log(`- Ambiguous matches: ${result.stats.ambiguous}`);
      console.log(`- Missing/Unresolved: ${result.stats.missing}`);
      console.log(`- Overrides applied: ${result.stats.overrides}`);

      if (result.stats.ambiguous > 0) {
        console.warn(`\nWarning: There are ${result.stats.ambiguous} ambiguous matches. Please review redirect-map.json/csv and provide overrides to resolve them.`);
      }

    } catch (err) {
      console.error(`Generation failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('validate')
  .description('Validate generated redirect maps for loops, chains, collisions, and optionally verify destination status.')
  .requiredOption('-m, --map <file>', 'Path to redirect-map.json')
  .option('-v, --verify', 'Optionally verify live destinations read-only over HTTP')
  .action(async (options) => {
    try {
      const mapPath = path.resolve(options.map);
      if (!fs.existsSync(mapPath)) {
        console.error(`Error: Redirect map file does not exist at ${mapPath}`);
        process.exit(1);
      }

      console.log('Validating redirect map...');
      const mapData = JSON.parse(fs.readFileSync(mapPath, 'utf8'));

      const validationResult = await validateRedirectMap(mapData, {
        verifyDestinations: !!options.verify,
      });

      console.log('\nValidation Results:');
      if (validationResult.loops.length > 0) {
        console.error('❌ Redirect Loops Detected:');
        validationResult.loops.forEach(loop => console.error(`  ${loop.join(' -> ')}`));
      } else {
        console.log('✓ No redirect loops detected.');
      }

      if (validationResult.chains.length > 0) {
        console.warn('⚠ Redirect Chains Detected (Multi-hop redirects):');
        validationResult.chains.forEach(chain => console.warn(`  ${chain.join(' -> ')}`));
      } else {
        console.log('✓ No redirect chains detected.');
      }

      if (validationResult.collisions.length > 0) {
        console.error('❌ Collisions/Conflicts Detected:');
        validationResult.collisions.forEach(conflict => {
          console.error(`  Source path "${conflict.source}" is mapped to multiple destinations: ${conflict.targets.join(', ')}`);
        });
      } else {
        console.log('✓ No mapping collisions/conflicts detected.');
      }

      if (validationResult.unresolvedRequired.length > 0) {
        console.error('❌ Unresolved Required URLs:');
        validationResult.unresolvedRequired.forEach(url => console.error(`  ${url}`));
      }

      if (options.verify) {
        console.log(`\nVerifying live destinations...`);
        if (validationResult.brokenDestinations.length > 0) {
          console.error('❌ Broken Destination URLs:');
          validationResult.brokenDestinations.forEach(broken => {
            console.error(`  ${broken.source} -> ${broken.target} (HTTP Status: ${broken.status}, Error: ${broken.error || 'None'})`);
          });
        } else {
          console.log('✓ All verified destination URLs are reachable (HTTP 200).');
        }
      }

      if (!validationResult.valid) {
        console.error('\nValidation status: FAILED ❌');
        process.exit(1);
      }

      console.log('\nValidation status: PASSED ✓');
    } catch (err) {
      console.error(`Validation failed: ${err.message}`);
      process.exit(1);
    }
  });

// Handle execute
if (import.meta.url === `file://${fs.realpathSync(process.argv[1])}`) {
  program.parse(process.argv);
}

export { program };
