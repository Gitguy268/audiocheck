# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue.

Use GitHub's private reporting form: <https://github.com/Gitguy268/audiocheck/security/advisories/new>

Include what you found, how to reproduce it, and the browser and version you used. You should get a reply within a week. Please give the fix time to ship before you publish details.

## Scope

Everything runs in the browser. There is no backend, no account and no analytics, and the built page carries a content security policy with `connect-src 'none'`, so it cannot make network requests. The README's [Privacy](README.md#privacy) section describes the policy. The most useful reports are about:

- an audio file, or a file or folder name, that runs script in the page or injects markup;
- anything that makes the page send data off the device;
- a file that makes the page report "checksum matches" for audio that does not match;
- the GitHub Actions workflows in this repository.

A file that makes the tab run out of memory or freeze is a bug, not a vulnerability; please open a normal issue.

## Supported versions

Only the latest version on the `main` branch is supported.
