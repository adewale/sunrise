import { describe, expect, it } from 'vitest';
import changelogMarkdown from '../CHANGELOG.md?raw';
import packageJson from '../package.json';
import versionManifest from '../sunrise.version.json';
import { SUNRISE_CHANGELOG, SUNRISE_VERSION } from '../src/version';

// sunrise.version.json is the file docs/agent-upgrade-contract.md tells a
// deployer's coding agent to read first. It, package.json, the in-app version
// card (src/version.ts) and the changelogs must all name the same release, or
// an upgrading agent works from the wrong baseline.

function topReleaseVersion(changelog: string): string | undefined {
  return changelog.match(/^## \[(\d+\.\d+\.\d+[^\]]*)\]/m)?.[1];
}

describe('version metadata stays in sync', () => {
  it('sunrise.version.json matches the in-app SUNRISE_VERSION field for field', () => {
    expect(versionManifest).toEqual({ ...SUNRISE_VERSION });
  });

  it('package.json has the same version', () => {
    expect(packageJson.version).toBe(SUNRISE_VERSION.version);
  });

  it('the newest CHANGELOG.md entry is the current version', () => {
    expect(topReleaseVersion(changelogMarkdown)).toBe(SUNRISE_VERSION.version);
  });

  it('the newest entry in the in-app changelog is the current version', () => {
    expect(topReleaseVersion(SUNRISE_CHANGELOG)).toBe(SUNRISE_VERSION.version);
  });
});
