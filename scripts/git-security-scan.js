#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ZERO_SHA = '0000000000000000000000000000000000000000';

const BINARY_EXT_RE = /\.(png|jpg|jpeg|gif|webp|avif|ico|woff2?|ttf|eot|svg|mp4|mp3|wav|pdf|zip|gz)$/i;

const PROHIBITED_PATH_RULES = [
  {
    name: 'Environment file (.env)',
    test: (p) => {
      const base = path.posix.basename(p);
      if (base === '.env.example') return false;
      return base === '.env' || base.startsWith('.env.') || base.endsWith('.env');
    }
  },
  {
    name: 'Private project instruction/changelog file',
    test: (p) => {
      const base = path.posix.basename(p);
      return base === 'AGENT.md' || base === 'AGENTS.md' || base === 'CHANGELOG.md' || p.startsWith('.agents/');
    }
  },
  {
    name: 'Dependencies or build output directory',
    test: (p) => /(?:^|\/)(?:node_modules|dist|dist-ssr|build|coverage)(?:\/|$)/.test(p)
  },
  {
    name: 'Log file or logs directory',
    test: (p) => /\.log$/i.test(p) || /(?:^|\/)logs(?:\/|$)/i.test(p)
  },
  {
    name: 'Private key or certificate',
    test: (p) => /\.(?:pem|key|p12|pfx|jks|keystore)$/i.test(p)
  },
  {
    name: 'Database dump or backup',
    test: (p) =>
      /\.(?:dump|bson|backup|sqlite|sqlite3)$/i.test(p) ||
      /(?:^|\/)(?:database-backup|db-backup|backups|mongodb-dumps)(?:\/|$)/i.test(p)
  },
  {
    name: 'Private documents or restricted uploads',
    test: (p) =>
      /(?:^|\/)(?:private-uploads|secure-uploads|customer-documents|vendor-documents|kyc-documents|aadhaar-documents|pan-documents|private-storage)(?:\/|$)/i.test(p)
  }
];

const SECRET_PATTERNS = [
  { name: 'AWS Access Key ID', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'AWS Secret Access Key', regex: /aws_secret_access_key\s*[:=]\s*['"]?[A-Za-z0-9/+=]{32,}['"]?/i },
  { name: 'MongoDB URI with credentials', regex: /mongodb(?:\+srv)?:\/\/[^:\s<>]+:[^@\s<>]+@[^\s'"]+/i },
  { name: 'Redis URL with password', regex: /redis:\/\/[^:\s<>]*:[^@\s<>]+@[^\s'"]+/i },
  { name: 'Cloudinary URL with API secret', regex: /cloudinary:\/\/[0-9]+:[^@\s<>]+@[^\s'"]+/i },
  { name: 'Private Key Material', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'Firebase Service Account Private Key', regex: /"private_key"\s*:\s*"-----BEGIN PRIVATE KEY-----/ },
  {
    name: 'Hardcoded Secret Assignment',
    regex: /\b(?:JWT_SECRET|REFRESH_TOKEN_SECRET|CLOUDINARY_API_SECRET|RAZORPAY_KEY_SECRET|PAYMENT_SECRET_KEY|OAUTH_CLIENT_SECRET|SMTP_PASSWORD)\s*[:=]\s*['"]?(?!your_|placeholder|<|process\.env)[A-Za-z0-9_\-!@#$%^&*+=]{12,}['"]?/
  }
];

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
}

function isSafePlaceholderLine(filePath, line) {
  if (filePath.endsWith('.env.example')) {
    return /<[^>]+>|your_|placeholder/i.test(line);
  }
  return false;
}

function checkProhibitedPath(filePath, findings) {
  const normalized = filePath.replace(/\\/g, '/');
  for (const rule of PROHIBITED_PATH_RULES) {
    if (rule.test(normalized)) {
      findings.push(`[PROHIBITED FILE] ${normalized} -> ${rule.name}`);
    }
  }
}

function scanContent(filePath, content, findings) {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized === 'scripts/git-security-scan.js' || BINARY_EXT_RE.test(normalized)) {
    return;
  }
  const lines = content.split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (isSafePlaceholderLine(normalized, line)) return;
    for (const pat of SECRET_PATTERNS) {
      if (pat.regex.test(line)) {
        findings.push(`[SECRET DETECTED] ${normalized}:${idx + 1} -> ${pat.name} (value redacted)`);
      }
    }
  });
}

function checkForceStagedIgnored(findings) {
  const out = git(['ls-files', '--cached', '--ignored', '--exclude-standard']).trim();
  if (!out) return;
  for (const file of out.split(/\r?\n/).filter(Boolean)) {
    findings.push(`[FORCE-STAGED IGNORED FILE] ${file} -> Ignored file must not be tracked`);
  }
}

function runStaged() {
  const findings = [];
  checkForceStagedIgnored(findings);
  const staged = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
    .split(/\r?\n/)
    .filter(Boolean);

  for (const file of staged) {
    checkProhibitedPath(file, findings);
    try {
      const content = git(['show', `:${file}`]);
      scanContent(file, content, findings);
    } catch {
      // Skip unreadable/submodule entries
    }
  }
  return findings;
}

function runPush() {
  const findings = [];
  checkForceStagedIgnored(findings);

  const stdin = fs.readFileSync(0, 'utf8').trim();
  const lines = stdin ? stdin.split(/\r?\n/).filter(Boolean) : [];

  for (const line of lines) {
    const [, localSha, , remoteSha] = line.trim().split(/\s+/);
    if (!localSha || localSha === ZERO_SHA) continue;

    const revRange = !remoteSha || remoteSha === ZERO_SHA ? localSha : `${remoteSha}..${localSha}`;
    const commits = git(['rev-list', revRange]).split(/\r?\n/).filter(Boolean);

    for (const sha of commits) {
      const changed = git(['diff-tree', '--no-commit-id', '--name-only', '-r', '--diff-filter=ACMR', sha])
        .split(/\r?\n/)
        .filter(Boolean);

      for (const file of changed) {
        checkProhibitedPath(file, findings);
        try {
          const content = git(['show', `${sha}:${file}`]);
          scanContent(file, content, findings);
        } catch {
          // Skip deleted/unreadable entries
        }
      }
    }
  }
  return findings;
}

function runCi() {
  const findings = [];
  checkForceStagedIgnored(findings);
  const tracked = git(['ls-files']).split(/\r?\n/).filter(Boolean);

  for (const file of tracked) {
    checkProhibitedPath(file, findings);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) continue;
    try {
      const content = fs.readFileSync(file, 'utf8');
      scanContent(file, content, findings);
    } catch {
      // Skip binary/unreadable files
    }
  }
  return findings;
}

const mode = process.argv[2] || '--staged';
let findings = [];

if (mode === '--staged') {
  findings = runStaged();
} else if (mode === '--push') {
  findings = runPush();
} else if (mode === '--ci') {
  findings = runCi();
} else {
  console.error(`Unknown mode: ${mode}. Use --staged, --push, or --ci.`);
  process.exit(2);
}

if (findings.length > 0) {
  console.error('\n[GIT SECURITY BLOCKED] Sensitive or prohibited content detected:\n');
  for (const item of [...new Set(findings)]) {
    console.error(`  - ${item}`);
  }
  console.error('\nRemove the prohibited file or secret before committing/pushing.\n');
  process.exit(1);
}

console.log(`[GIT SECURITY] Passed (${mode}).`);

