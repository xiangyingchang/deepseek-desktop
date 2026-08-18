#!/usr/bin/env node
/**
 * Render the GitHub issue artifacts for the scheduled Harness Update Check.
 *
 * Input: one `dsh-stack harness-check --json` report file.
 * Output, written into --out-dir (default "."):
 *   - harness-issue-title.txt         issue title (UPDATE_AVAILABLE)
 *   - harness-issue-body.md           issue body (UPDATE_AVAILABLE)
 *   - harness-issue-close-comment.txt auto-close comment (UP_TO_DATE)
 *
 * With --summary the script prints a Markdown run summary to stdout; all
 * diagnostics go to stderr. The script never contacts GitHub: the workflow
 * feeds these files to `gh`. Keeping rendering separate from `gh` makes the
 * issue content locally testable:
 *
 *   node scripts/harness-update-issue.mjs \
 *     --check harness-check.json --ref master \
 *     --run-url https://github.com/xiangyingchang/deepseek-desktop/actions/runs/1
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

function shortCommit(commit) {
  if (typeof commit !== 'string' || commit.length === 0) return 'unknown'
  return commit.length >= 12 ? commit.slice(0, 12) : commit
}

function cell(value) {
  return value === undefined || value === null || value === '' ? 'unknown' : String(value)
}

const USAGE =
  'Usage: node scripts/harness-update-issue.mjs --check <harness-check.json> ' +
  '[--ref master] [--run-url <url>] [--out-dir .] [--summary]'

const { values } = parseArgs({
  options: {
    check: { type: 'string' },
    ref: { type: 'string', default: 'master' },
    'run-url': { type: 'string', default: '' },
    'out-dir': { type: 'string', default: '.' },
    summary: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
})

if (values.help) {
  console.error(USAGE)
  process.exit(0)
}
if (!values.check) {
  console.error(USAGE)
  process.exit(1)
}

const report = JSON.parse(await readFile(values.check, 'utf8'))
const status = report?.status
if (status !== 'UP_TO_DATE' && status !== 'UPDATE_AVAILABLE' && status !== 'UNAVAILABLE') {
  console.error(`Unsupported harness-check status: ${String(status)}`)
  process.exit(1)
}

const current = report.current ?? {}
const candidate = report.candidate
const ref = values.ref
const runUrl = values['run-url']
const observedAt = cell(report.observedAt)
const outDir = resolve(values['out-dir'])
const written = []

if (status === 'UPDATE_AVAILABLE') {
  const title = `Harness update available: ${cell(candidate?.version)} (${shortCommit(candidate?.commit)})`
  const body = [
    '## Official Harness update available',
    '',
    '| | Version | Commit |',
    '|---|---|---|',
    `| Current | ${cell(current.version)} | \`${cell(current.commit)}\` |`,
    `| Candidate on \`${ref}\` | ${cell(candidate?.version)} | \`${cell(candidate?.commit)}\` |`,
    '',
    `- Ref checked: \`${ref}\``,
    `- Observed at: ${observedAt}`,
    runUrl === '' ? null : `- Detected by: ${runUrl}`,
    '',
    '### Next step (manual, verified)',
    '',
    '```sh',
    'pnpm dsh-stack harness-update examples/reference ../deepseek-harness \\',
    `  --remote origin --ref ${ref} \\`,
    '  --apply --report ./artifacts/harness-update.json',
    '```',
    '',
    'This issue is managed by the scheduled **Harness Update Check** workflow. It is',
    'refreshed on every check while an update is available and closes automatically',
    'when the checkout is up to date again. The workflow never applies an update',
    'itself; `harness-update --apply` stays an explicit maintainer decision.',
    '',
    'See docs/harness-update.md for the two-phase update contract.',
  ].filter(line => line !== null).join('\n')
  await writeFile(join(outDir, 'harness-issue-title.txt'), `${title}\n`)
  await writeFile(join(outDir, 'harness-issue-body.md'), `${body}\n`)
  written.push('harness-issue-title.txt', 'harness-issue-body.md')
}

if (status === 'UP_TO_DATE') {
  const comment = [
    `Up to date again: ${cell(current.version)} (\`${cell(current.commit)}\`) at ${observedAt}.`,
    'Closing automatically; the workflow opens a new tracker if a new upstream',
    'update appears later.',
  ].join('\n')
  await writeFile(join(outDir, 'harness-issue-close-comment.txt'), `${comment}\n`)
  written.push('harness-issue-close-comment.txt')
}

if (values.summary) {
  const summary = [
    `### Harness Update Check: \`${status}\``,
    '',
    '| Field | Value |',
    '|---|---|',
    `| Ref checked | \`${ref}\` |`,
    `| Current | ${cell(current.version)} @ \`${shortCommit(current.commit)}\` |`,
  ]
  if (candidate !== undefined) {
    summary.push(`| Candidate | ${cell(candidate.version)} @ \`${shortCommit(candidate.commit)}\` |`)
  }
  if (report.diagnostic?.code !== undefined) {
    summary.push(`| Diagnostic | ${cell(report.diagnostic.code)}: ${cell(report.diagnostic.message)} |`)
  }
  summary.push(`| Observed at | ${observedAt} |`)
  if (status === 'UPDATE_AVAILABLE') {
    summary.push('', 'A tracking issue stays open with the verified manual update command.')
  } else if (status === 'UP_TO_DATE') {
    summary.push('', 'No action needed.')
  } else {
    summary.push('', 'The check itself failed; see the job log for diagnostics.')
  }
  process.stdout.write(`${summary.join('\n')}\n`)
}

console.error(`Rendered ${status} artifacts in ${outDir}: ${written.length === 0 ? 'none' : written.join(', ')}`)
