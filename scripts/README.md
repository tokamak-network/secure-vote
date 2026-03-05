# Development Scripts

Quick start scripts for MACI + MaciRLA development.

## Quick Start

```bash
# Start development environment (tmux)
./scripts/dev.sh

# Stop all services
./scripts/stop.sh
```

## What `dev.sh` Does

1. ✓ Check dependencies (tmux, node, npx)
2. ✓ Create tmux session with 3 panes
3. ✓ Start Hardhat node (pane 0)
4. ✓ Wait for node ready (port 8545)
5. ✓ Deploy contracts (pane 2)
6. ✓ Start frontend (pane 1)

## Tmux Layout

```
┌─────────────────────┬─────────────────────┐
│ [Hardhat Node]      │ [Frontend]          │
│ Pane 0              │ Pane 1              │
│                     │                     │
│ Listening on :8545  │ Ready on :3001      │
│ Account #0: 0x...   │ ○ Compiling...      │
│ Account #1: 0x...   │ ✓ Compiled          │
│                     │                     │
├─────────────────────┴─────────────────────┤
│ [Deployment & Status]                     │
│ Pane 2                                    │
│                                           │
│ ✓ MACI deployed: 0xB7f8BC...             │
│ ✓ MaciRLA deployed: 0x5FbDB2...          │
│ ✅ Platform Ready!                        │
│ Frontend: http://localhost:3001           │
└───────────────────────────────────────────┘
```

## Tmux Commands

```bash
# Attach to session
tmux attach -t securevote

# Detach from session (keep running)
Ctrl+B, D

# Switch between panes
Ctrl+B, Arrow Keys

# Stop all (inside tmux)
Ctrl+C
```

## Full E2E Workflow

The development environment supports the complete workflow:

1. **Create Election** → `/elections/create`
2. **Vote** → Encrypted MACI messages
3. **Tally** → Coordinator processes votes
4. **Sample ZKP** → MaciRLA Phase 3 (margin-adaptive sampling)
5. **Challenge** → Phase 5 (7-day window)
6. **Full Proof** → Phase 6 (coordinator responds with all proofs)

## Coordinator Actions

Visit `/coordinator` after starting:
- Commit results
- Generate sample proofs
- Respond to challenges
- Finalize elections

## Troubleshooting

**Port already in use:**
```bash
./scripts/stop.sh  # Clean up
./scripts/dev.sh   # Restart
```

**Tmux not found:**
```bash
sudo apt install tmux
```

**Node version error:**
```bash
# Install Node 20+ via nvm
nvm install 20
nvm use 20
```

**Deployment hangs:**
- Check Hardhat node logs (pane 0)
- Ensure port 8545 is accessible
- Ctrl+C and restart

## Alternative: Without tmux

If tmux is not available, use the original script:

```bash
cd maci-test
./scripts/start-platform.sh
```

This runs services sequentially (node → deploy → frontend).
