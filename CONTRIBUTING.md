# Contributing to cmux

## Prerequisites

- macOS 14+
- Xcode 15+
- [Zig](https://ziglang.org/) (install via `brew install zig`)

## Getting Started

1. Clone the repository with submodules:
   ```bash
   git clone --recursive https://github.com/manaflow-ai/cmux.git
   cd cmux
   ```

2. Run the setup script:
   ```bash
   ./scripts/setup.sh
   ```

   This will:
   - Initialize git submodules (ghostty, homebrew-cmux)
   - Build the GhosttyKit.xcframework from source
   - Create the necessary symlinks

3. Build and launch the installed app:
   ```bash
   ./scripts/reloadp.sh
   ```
   Clean leftover local build artifacts with:
   ```bash
   ./scripts/prune-local-apps.sh
   ```

## Development Scripts

| Script | Description |
|--------|-------------|
| `./scripts/setup.sh` | One-time setup (submodules + xcframework) |
| `./scripts/reloadp.sh` | Rebuild, install, and launch `/Applications/bmux.app` |
| `./scripts/reload.sh` | Compatibility wrapper that forwards to `./scripts/reloadp.sh` |
| `./scripts/prune-local-apps.sh` | Remove leftover local build artifacts outside `/Applications/bmux.app` |
| `./scripts/rebuild.sh` | Clean rebuild |

## Rebuilding GhosttyKit

If you make changes to the ghostty submodule, rebuild the xcframework:

```bash
cd ghostty
zig build -Demit-xcframework=true -Doptimize=ReleaseFast
```

## Running Tests

### Basic tests (run on VM)

```bash
ssh bmux-vm 'cd /Users/bmux/GhosttyTabs && ./scripts/run-tests-v1.sh'
```

### UI tests (run on VM)

```bash
ssh cmux-vm 'cd /Users/cmux/GhosttyTabs && xcodebuild -project GhosttyTabs.xcodeproj -scheme cmux -configuration Debug -destination "platform=macOS" -only-testing:cmuxUITests test'
```

## Ghostty Submodule

The `ghostty` submodule points to [manaflow-ai/ghostty](https://github.com/manaflow-ai/ghostty), a fork of the upstream Ghostty project.

### Making changes to ghostty

```bash
cd ghostty
git checkout -b my-feature
# make changes
git add .
git commit -m "Description of changes"
git push manaflow my-feature
```

### Keeping the fork updated

```bash
cd ghostty
git fetch origin
git checkout main
git merge origin/main
git push manaflow main
```

Then update the parent repo:

```bash
cd ..
git add ghostty
git commit -m "Update ghostty submodule"
```

See `docs/ghostty-fork.md` for details on fork changes and conflict notes.

## License

By contributing to this repository, you agree that:

1. Your contributions are licensed under the project's GNU General Public License v3.0 or later (`GPL-3.0-or-later`).
2. You grant Manaflow, Inc. a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use, reproduce, modify, sublicense, and distribute your contributions under any license, including a commercial license offered to third parties.
