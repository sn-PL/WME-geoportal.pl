'use strict';
/**
 * A tiny check runner: every check is named, prints one line, and a non-zero
 * process exit says something is wrong. No test framework, so the suites can be
 * run with nothing but Node and jsdom installed.
 */
const RESET = '\u001b[0m';
const RED = '\u001b[31m';
const GREEN = '\u001b[32m';
const DIM = '\u001b[2m';
const color = process.env.NO_COLOR ? '' : undefined;

class Report {
  constructor() {
    this.passed = 0;
    this.failed = 0;
    this.failures = [];
    this.currentSuite = '';
  }

  suite(name) {
    this.currentSuite = name;
    console.log(`\n${DIM}── ${name} ${'─'.repeat(Math.max(0, 66 - name.length))}${RESET}`);
  }

  /**
   * @param {string} name what is being checked, as a sentence
   * @param {boolean} ok
   * @param {string} [detail] the values behind the answer
   */
  check(name, ok, detail = '') {
    if (ok) {
      this.passed++;
      console.log(`  ${GREEN}PASS${RESET} ${name}${detail ? `  ${DIM}→ ${detail}${RESET}` : ''}`);
    } else {
      this.failed++;
      this.failures.push(`[${this.currentSuite}] ${name}${detail ? ` — ${detail}` : ''}`);
      console.log(`  ${RED}FAIL${RESET} ${name}${detail ? `  ${DIM}→ ${detail}${RESET}` : ''}`);
    }
    return ok;
  }

  /** The same check for every entry of a map/array, so one failure names its case. */
  each(entries, name, run) {
    for (const [key, value] of entries) {
      const result = run(value, key);
      if (typeof result === 'string') this.check(`${name}: ${key}`, false, result);
      else if (result) this.check(`${name}: ${key}`, true);
    }
  }

  summary() {
    console.log(`\n${this.failed ? RED : GREEN}${this.passed} passed, ${this.failed} failed${RESET}`);
    if (this.failures.length) {
      console.log('\nFailures:');
      this.failures.forEach(failure => console.log(`  ${RED}•${RESET} ${failure}`));
    }
    return this.failed === 0;
  }
}

module.exports = { Report, color };
