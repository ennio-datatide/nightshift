# Contributing

Thanks for helping. Issues and pull requests are welcome.

- Node 22 or later. `npm ci`, then `npm test` (it builds first).
- Tests use plain `node --test`, no framework. Test behaviour through the runner, the loader, the
  reviewer and the scheduler, with the SDK's `query` and the clock injected. No test may need a
  Claude login or the network.
- A change to the agent file format updates the loader, its tests and the
  [agent file reference](README.md#agent-file-reference) together.
- Anything that widens what an agent can do needs a test that shows the limit still holds.
- Keep runtime dependencies to the three there are.
- By contributing you agree your work is released under the MIT licence.

Security issues: see [SECURITY.md](SECURITY.md), not the issue tracker.
