#!/usr/bin/env node
/**
 * Keep editorial articles discoverable from more than the blog index.
 *
 * `app/web/blog/related-articles.json` is the source of truth for short,
 * contextual "Keep exploring" blocks. The blocks are written between markers
 * in every article, so a page cannot quietly become a sitemap-only URL when
 * another article is added or edited.
 *
 * Usage:
 *   node scripts/build-blog-links.mjs          # update generated blocks
 *   node scripts/build-blog-links.mjs --check  # fail if generated blocks drift
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const BLOG_DIR = path.join(APP_ROOT, 'web', 'blog');
const DATA_PATH = path.join(BLOG_DIR, 'related-articles.json');
const CHECK = process.argv.slice(2).includes('--check');

if (process.argv.slice(2).some((arg) => arg !== '--check')) {
  throw new Error('Usage: node scripts/build-blog-links.mjs [--check]');
}

const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
const articles = data.articles;
if (!Array.isArray(articles) || articles.length < 2) {
  throw new Error('related-articles.json must contain at least two articles');
}

const bySlug = new Map();
for (const article of articles) {
  if (!article.slug || !article.title || !article.label || !article.summary || !Array.isArray(article.related)) {
    throw new Error(`Invalid related-articles entry: ${JSON.stringify(article)}`);
  }
  if (bySlug.has(article.slug)) throw new Error(`Duplicate article slug: ${article.slug}`);
  if (article.related.length < 2) throw new Error(`${article.slug} needs at least two related articles`);
  bySlug.set(article.slug, article);
}
for (const article of articles) {
  const distinct = new Set(article.related);
  if (distinct.size !== article.related.length) throw new Error(`${article.slug} repeats a related article`);
  for (const slug of article.related) {
    if (slug === article.slug) throw new Error(`${article.slug} cannot link to itself`);
    if (!bySlug.has(slug)) throw new Error(`${article.slug} links to unknown article ${slug}`);
  }
}

const esc = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const BEGIN = '<!-- BEGIN AUTO:RELATED-READING -->';
const END = '<!-- END AUTO:RELATED-READING -->';

function renderRelatedReading(article) {
  const cards = article.related.map((slug) => {
    const related = bySlug.get(slug);
    return `        <article data-reveal>
          <span class="tag">${esc(related.label)}</span>
          <h3><a href="/blog/${esc(related.slug)}">${esc(related.title)}</a></h3>
          <p>${esc(related.summary)}</p>
          <a class="niche-browse" href="/blog/${esc(related.slug)}">Read the guide →</a>
        </article>`;
  }).join('\n');

  return `      ${BEGIN}
      <section class="related-reading" aria-labelledby="related-reading-${esc(article.slug)}">
        <p class="kicker">Keep exploring</p>
        <h2 id="related-reading-${esc(article.slug)}" data-reveal>More useful reads from Plus One</h2>
        <div class="grid related-reading-grid" data-reveal-group>
${cards}
        </div>
      </section>
      ${END}`;
}

function trimTrailingBlankLines(value) {
  return value.replace(/(?:[ \t]*\r?\n)*[ \t]*$/, '');
}

function inject(source, block, file) {
  const beginAt = source.indexOf(BEGIN);
  const endAt = source.indexOf(END);
  if (beginAt !== -1 || endAt !== -1) {
    if (beginAt === -1 || endAt === -1 || endAt < beginAt) {
      throw new Error(`${file} has incomplete related-reading markers`);
    }
    // beginAt is after the line's indentation. Remove that indentation and
    // any whitespace-only line before putting a fully-indented block back,
    // otherwise each build makes the generated source perpetually stale.
    const before = trimTrailingBlankLines(source.slice(0, beginAt));
    return `${before}\n${block}${source.slice(endAt + END.length)}`;
  }

  const mainEnd = source.lastIndexOf('</main>');
  if (mainEnd === -1) throw new Error(`${file} has no </main> to receive related reading`);
  const before = trimTrailingBlankLines(source.slice(0, mainEnd));
  return `${before}\n${block}\n    ${source.slice(mainEnd)}`;
}

let changed = 0;
for (const article of articles) {
  const file = path.join(BLOG_DIR, `${article.slug}.html`);
  if (!fs.existsSync(file)) throw new Error(`Article not found: ${path.relative(APP_ROOT, file)}`);
  const source = fs.readFileSync(file, 'utf8');
  const output = inject(source, renderRelatedReading(article), path.relative(APP_ROOT, file));
  if (source !== output) {
    if (CHECK) {
      console.error(`[related-reading] ${path.relative(APP_ROOT, file)}: out of date — run node scripts/build-blog-links.mjs`);
      changed += 1;
    } else {
      fs.writeFileSync(file, output);
      console.log(`[related-reading] ${path.relative(APP_ROOT, file)}: updated`);
      changed += 1;
    }
  } else {
    console.log(`[related-reading] ${path.relative(APP_ROOT, file)}: ok`);
  }
}

if (CHECK && changed > 0) process.exit(1);
console.log(`[related-reading] ${CHECK ? 'check passed' : 'build done'} — ${articles.length} article blocks.`);
