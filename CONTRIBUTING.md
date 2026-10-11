# Contributing

Thanks for helping with audiocheck.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting a bug or asking for a feature

Open an [issue](https://github.com/Gitguy268/audiocheck/issues/new/choose) and use the template. For a wrong verdict, say what the file is (format, sample rate, how it was made if you know), what audiocheck said and what you expected. Please don't attach copyrighted music; a spectrogram screenshot is usually enough.

Report security problems privately: see [SECURITY.md](SECURITY.md).

## Making a change

1. Fork the repository and create a branch from `main`.
2. Set it up and run it (Node 24 or newer; `.nvmrc` pins the version this is built with):

   ```sh
   npm ci
   npm run dev        # http://localhost:5173
   ```

3. Make your change. Keep commits small, each with a clear message.
4. Run the checks below and update the README if behaviour changed.
5. Open a pull request and fill in the template.

## Checks

```sh
npm run check      # lint, typecheck, unit tests, build
npm run fixtures   # generate the test audio with ffmpeg (needs ffmpeg with libmp3lame)
npm run test:e2e   # Playwright against the production build
```

If you change a threshold in `src/analyze.ts`, say in the pull request which files you tried it on. The two fixtures marked "held out" in `tests/e2e/check.spec.ts` are there to catch tuning that only fits the test files.

## Licences

The code is MIT licensed (see [LICENSE](LICENSE)), and your contribution is accepted under the same licence. Don't add libraries, fonts, images or audio unless their licence allows redistribution, and list each one in [NOTICE](NOTICE) in the same pull request. Don't copy code from GPL or LGPL projects (Spek, LAME, auCDtect clones and the like); ideas and published numbers are fine, with credit.
